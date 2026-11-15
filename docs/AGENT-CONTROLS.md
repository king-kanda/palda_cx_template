# Agent controls, knowledge and memory

How each customer's agent is configured from the Engine, what it knows, and what it remembers. The customer only configures their communication accounts; everything here is done by the Palda team.

## 1. Per-customer configuration (Engine, `Agent` group)

| Screen | Path | What it controls |
| --- | --- | --- |
| Profile & voice | `/engine/<id>/agent` | Name, picture, tone, notes (built into the persona by `applyAgentProfile`) |
| Tools | `/engine/<id>/agent/tools` | Which tools the customer-facing agent may use, and the max tool calls per message |
| Knowledge | `/engine/<id>/agent/knowledge` | Documents the agent can search (policies, FAQs). Has a "Try a question" box showing what it would find |
| Memory | `/engine/<id>/agent/memory` | Facts the agent has saved about this customer's end-customers, with delete |
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

## 5. Evals

```bash
pnpm eval:mock                        # offline replay of scripted plans; exact; free. 49 scenarios
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
| `tests/integration/knowledge-memory.test.ts` | Tenant and customer isolation, RLS as a restricted role, recall, caps, deletes, the tools |
