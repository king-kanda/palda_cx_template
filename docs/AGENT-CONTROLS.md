# Agent controls, knowledge and memory

How each customer's agent is configured from the Engine, what it knows, and what it remembers. The customer only configures their communication accounts; everything here is done by the Palda team.

## 1. Per-customer configuration (Engine, `Agent` group)

| Screen | Path | What it controls |
| --- | --- | --- |
| Profile & voice | `/engine/<id>/agent` | Name, picture, tone, notes (built into the persona by `applyAgentProfile`) |
| Tools | `/engine/<id>/agent/tools` | Everything the agent may do: the built-in tools, then the tools from the apps connected for the customer, each switched on or off here. Also max tool calls per message |
| Knowledge | `/engine/<id>/agent/knowledge` | Documents the agent can search (policies, FAQs). Has a "Try a question" box showing what it would find |
| Memory | `/engine/<id>/agent/memory` | Facts the agent has saved about this customer's end-customers, with delete |
| Integrations | `/engine/<id>/agent/integrations` | Connect and list the apps for this customer (Zoho Books, Google Workspace, ...). Section 4b |
| Runs | `/engine/<id>/runs` | Every agent run, with trace links |

### Tools: versions, not edits

A customer's tool settings are stored as immutable rows in `agent_versions` with a pointer in `agent_pointers` (production). Publishing adds a version and moves the pointer; **Roll back** moves it again; "Use these" on *Shipped defaults* removes the pointer. Every change is written to `audit_log` (`engine.agent_published`, `engine.agent_version_activated`).

`loadAgentConfig` (`apps/agent-service/src/agent-config.ts`) applies the live version **and can only add restrictions**: the shipped blocked tools and any shipped allow-list are always re-applied, and `maxToolCalls` is capped. A hand-edited version row cannot remove a safety block.

The list shows tools a customer principal can see (18 today). Staff-only tools (`messages.send`, `approvals.decide`, `blocks.*`) are never offered to the customer-facing agent. Per-customer control of the staff-side agents (admin, ops, digest) is not built yet.

## 2. Vector storage (Qdrant) and isolation

Postgres is the source of truth and holds the **text** (tables `knowledge_documents`, `knowledge_chunks`, `customer_memories`, all with RLS). Qdrant holds only **vectors plus a few filter fields**, with the same ids. If Qdrant is wiped, the Engine **Reindex** button (or `reindexKnowledge` / `reindexMemories`) rebuilds it from Postgres.

Isolation, in layers (`packages/integrations/src/vector.ts`):

1. The only way to reach the store is `vectorsFor(tenantId)`. Callers cannot pass a filter or choose a tenant.
2. Every write stamps `tenant_id`; every search and delete is ANDed with `tenant_id`. Qdrant's `tenant_id` index is created with `is_tenant`.
3. Hits are re-checked on the way out; a foreign hit is dropped and counted (`vectorLeakGuard.dropped`, expected 0).
4. Text is read back from Postgres filtered by tenant, so a stray id resolves to nothing.
5. Memories are additionally scoped to one customer, and a memory search without a customer is refused.
6. Qdrant needs an API key (`QDRANT_API_KEY`) and is bound to `127.0.0.1` on the host.

**Note on RLS in local development:** the local database connects as a superuser, which bypasses RLS (documented in `runbook.md`). Locally, isolation comes from the explicit `tenant_id` filter in every query; the RLS policies are the second layer in production with a non-superuser role. `tests/integration/knowledge-memory.test.ts` proves the policies themselves by switching to a restricted role inside a transaction.

Settings (`.env`): `VECTOR_MODE` (`qdrant` | `mock`), `QDRANT_URL`, `QDRANT_API_KEY`, `EMBEDDING_MODE` (`openrouter` | `mock`), `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`. One collection exists per vector size (`garden_vectors_<dims>`); changing the model or size needs a reindex. Mock mode is in-memory and hash-based (with crude stemming), for tests and offline evals only.

## 3. Knowledge

Add a document in the Engine; it is chunked (about 700 characters, paragraph and sentence aware), embedded and stored. The agent gets two sources: `knowledge.get_business_info` (structured facts, hours, prices, FAQ from settings) and `knowledge.search` (semantic search over documents). Results carry a title and score; below `KNOWLEDGE_MIN_SCORE` (default 0.15) nothing is returned and the agent is told not to guess.

Document text is **reference data, not instructions**. The engine blocks tools the agent was not granted, and the reply guard treats policy phrases like "free of charge" as allowed only when this run's own tool results say them. Statements of action ("I have refunded") are never allowed.

## 4. Memory

The agent does not relearn each time, and it does not remember everything. Each turn it receives:

- the last 20 messages of the conversation,
- a structured customer summary built from the database (name, language, upcoming and recent bookings),
- **saved facts** about this customer (`customer_memories`): the few closest in meaning to the new message, plus the latest three, shown under "Additional context" as untrusted data.

The agent saves a fact with `memory.remember` (one short fact). `checkMemoryFact` refuses anything that looks like an instruction, a link or email, a long number (phone, ID, card), a claim of entitlement ("is allowed a free upgrade"), or markup. Limits: 200 characters, 30 facts per customer, duplicates ignored. A customer-facing agent can only write for the customer it is talking to and cannot delete; staff and the Engine can delete, and `forgetCustomer` erases everything for a customer.

Not built yet: letting a customer ask to be forgotten through the agent (today it hands over to staff), and summarising long past conversations.

## 4a. Invoices for the customer-facing agent

The agent can create and send an invoice for the customer it is talking to (`invoices.generate`, `invoices.send`, `invoices.get`, `invoices.list`; scopes `invoices:read_own` / `invoices:write_own`). The amount is always computed by the server from the booking and payments; the agent only chooses the kind (deposit, balance, full), so it cannot set a price, and a customer cannot choose the due date.

Ownership is enforced in the services, not just the tool: a customer principal can only touch invoices of its own bookings, and anything else returns "not found" (never "forbidden", so ids can't be probed). Asking twice returns the same open invoice. The invoice is sent only to that customer's own verified WhatsApp number. Staff behaviour is unchanged. Tested with two customers of the same business and a customer of another business (`customer-invoices.test.ts`).

The agent can list the invoices of the customer it is talking to, not other customers. A customer-facing agent never sees the customer list: that would expose one customer's details to another. Staff-side agents (admin, ops) can list customers as before.

## 4b. Connected apps (the Palda team connects them; the customer just sees them)

A customer's business apps (Zoho Books, Google Workspace, QuickBooks, HubSpot and so on) are connected to their agent **by the Palda team in the Engine**. The customer never connects, configures or even sees the technical side (server addresses, tokens, tool names). In their app, **Integrations** is a read-only list of the apps connected for them, in plain language.

Under the hood each app is reached through an MCP server whose address the Palda team enters, because the addresses differ by provider and plan. The catalog (`packages/services/src/integrations-catalog.ts`) gives each app a friendly name, a category and a one-line description for the customer: Zoho Books, Google Workspace, Microsoft 365, QuickBooks, Xero, Zoho CRM, HubSpot, Calendly, Notion, Slack, or "Other app" with a name the team chooses. It deliberately holds no connection details.

| | Customer | Palda team (Engine) |
| --- | --- | --- |
| Connect an app (pick it, enter its address and token) | no | yes, Engine > Agent > **Integrations** |
| See which apps are connected and their status | yes, read-only, plain language | yes, with addresses |
| Pause, resume, remove | no | yes |
| **Switch a tool on or off** | no | yes, Engine > Agent > **Tools** |

The two Engine screens split cleanly: **Integrations** is where apps are connected and listed; **Tools** is where each of an app's tools is switched on or off (alongside the built-in tools).

What the customer's page can show is limited by construction (`getCustomerIntegrations`): the app name, category and summary, a status (Connected, Paused, Needs attention), how many features the assistant may use, and when it was last checked. It carries no address, token, tool names or raw error text (an error could reveal the server's address), and there is no customer write path at all.

How it works:

1. The Palda team connects an app: picks it from the catalog (the short name fills in), enters its address and an optional bearer token. The Engine connects once to prove it works and reads its tools. **Every tool starts off.**
2. The Palda team reads each tool's name, description and inputs on the Tools screen and switches on only what that agent needs. Tools appear to the agent as `ext_<server>_<tool>` and never replace a built-in tool.
3. Each approved tool is bound to a **fingerprint** of exactly what staff reviewed. If the server later changes a tool (name, description or inputs), **Sync tools** switches it off and flags it "changed" until staff review it again. This defends against a server rewriting a description to steer the agent.
4. A server can be assigned to specific agents (default: the customer-facing one), disabled with one click, or removed. Every change is in `audit_log` (`engine.mcp_*`).

Safety, in layers (`packages/integrations/src/external-mcp.ts`):

- https only, no credentials in the URL, no redirects. Private, loopback, link-local (including the cloud metadata address) and carrier-grade NAT ranges are refused, for IPv4, IPv6 and IPv4-mapped forms.
- The address check runs **on the actual connection** (undici `lookup`), not only before it, so a host name that resolves to a private address, or changes its answer after the check, cannot reach one.
- The token is encrypted at rest (`encryptJson`), never returned to a browser, never written to the audit log.
- What comes back is untrusted: names validated, descriptions cleaned and capped, at most 100 tools, schemas capped at 8,000 characters, results text-only and truncated at 8,000 characters, 15 to 20 second timeouts, request arguments capped at 4,000 characters.
- Results reach the agent labelled as data from an outside system that can never change its rules. A failing or slow server never stops a customer getting an answer: the built-in tools still work.

Development only: `EXTERNAL_MCP_ALLOW_PRIVATE=true` and `EXTERNAL_MCP_ALLOW_INSECURE=true` let you connect to an MCP server on localhost or your LAN (from Docker use `host.docker.internal`). Both default to false in `docker-compose.yml`; keep them false in production.

Not built yet: per-tool "needs approval" before an external tool runs (today a tool is simply on or off), legacy SSE servers (Streamable HTTP only), OAuth flows (bearer tokens only), and per-customer control of external tools for the staff-side agents.

## 4c. Natural conversation

The customer-facing agent should read like the person looking after the booking.

- **It never talks about being software.** The instructions forbid calling itself an AI, bot, assistant or chatbot, mentioning tools or lookups, and stock phrases ("How may I assist you today?", "Certainly!", "Is there anything else I can help you with?"). It mirrors the customer's language (English, Swahili, Sheng), formality and pace, and writes short WhatsApp-style messages.
- **Introduction is a per-customer setting** (Engine, Agent > Profile & voice): *Say hello with the name* (once, in passing, on the first message of a chat, e.g. "Hi, it's Zuri") or *Don't introduce, just carry on*. It never introduces itself again after that.
- **A guard enforces it** (`checkSelfReference`): a reply that brings up being software, unasked, is blocked and replaced (after one rewrite attempt with a real model). Customer names that look like model names (Claude, Gemini) and phrases like "I'm real sorry" are not mistaken for it.
- **The one boundary:** if a customer sincerely asks whether they are talking to a person or a bot, the agent does not claim to be a person. It answers in one short, friendly sentence in its own voice ("I'm Zuri, the virtual assistant for X; I can get someone from the team if you'd rather") and carries on. A reply that claims to be human is always blocked, asked or not. This is deliberate: customers decide what to share and whether to trust a quote based on who they think they are talking to.
- **Fallbacks sound like a person stepping aside**, not a system: "Let me check that with the team and come back to you shortly", not "One moment please. Thank you for your patience."
- **Delivery is paced** (`sendNatural`): a long reply goes out as up to three short messages, with a pause scaled to length (about 0.6 to 2.2 seconds, varied, capped at 4.5 seconds total), and a typing indicator while the agent works. On for real WhatsApp, off in mock mode; `HUMAN_PACING=on|off` overrides. The typing indicator uses the Cloud API read-receipt typing field and is best effort. It has not been tried against a real number, so confirm it when you first test with live keys.

## 5. Evals

```bash
pnpm eval:mock                        # offline replay of scripted plans; exact; free. 53 scenarios
pnpm eval                             # REAL model against scripted tool results (OPENROUTER_API_KEY + a real WAMBO_MODEL, or --model=<id>)
pnpm eval -- --only=<id> --runs=3     # one scenario, repeated
```

Mock mode proves the engine's guards and rules. Real mode checks the model's choices: a **safety failure** (forbidden tool, forbidden text) always fails the run; wording or tool-choice differences are reported as warnings because real models phrase things differently. Before this change `pnpm eval` silently ran the mock; it now needs a real key.

Knowledge and memory scenarios (`agent-engine/src/scenarios-knowledge.ts`): answering from a document, saying "I'll check with the team" when nothing matches, a document that contains instructions, a hijacked model trying to call a blocked tool, using a saved preference, saving a preference, refusing to save card or ID numbers, a poisoned memory granting a discount, and not pretending to remember.

## 6. Tests

| Suite | Covers |
| --- | --- |
| `tests/unit/vector.test.ts` | Mock store isolation |
| `tests/unit/knowledge.test.ts` | Chunking, the memory safety filter |
| `tests/integration/vector-qdrant.test.ts` | Isolation against a live Qdrant (skipped if unreachable) |
| `tests/integration/agent-control.test.ts` | Versions, rollback, restrictions-only, audit |
| `tests/integration/customer-invoices.test.ts` | A customer can invoice only their own booking; other customers and businesses get not-found; staff unchanged |
| `tests/unit/external-mcp.test.ts` | Address and URL rules (private, metadata, IPv6, mapped), tool fingerprints and the change-detection merge |
| `tests/integration/external-mcp.test.ts` | A real local MCP server: add, discover, tools start off, token encrypted, isolation, calling, injection labelled as data, changed tool switches off, disable and remove, audit |
| `tests/integration/knowledge-memory.test.ts` | Tenant and customer isolation, RLS as a restricted role, recall, caps, deletes, the tools |
