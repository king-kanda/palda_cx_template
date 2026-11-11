# Handoff — Garden Booking OS

> Written for the next engineer/agent picking this repo up cold, or for a reviewer
> starting a code review. Pair this with [`STATUS.md`](./STATUS.md) (where the build
> actually is) and [`../PLAN.md`](../PLAN.md) (what it is meant to be).

## 1. What this is

A multi-tenant booking + operations system for Kenyan service businesses, with an
AI concierge (Wambo), WhatsApp and M-Pesa. The first vertical is an event garden;
salon, dental and consultancy ship as presets on the same core.

Three deployables:

1. **Booking app** (`apps/web`) — Next.js staff UI, server actions, PDF invoices,
   M-Pesa callback, and the per-tenant MCP server at `/api/mcp`.
2. **Worker** (`apps/worker`) — pg-boss jobs: reminders, hold expiry, approval
   expiry, 07:00 Nairobi digest, event forwarding.
3. **Agent service** (`apps/agent-service`) — WhatsApp webhook, Wambo/staff turns,
   per-conversation advisory locks, digest endpoint.

Plus two reusable packages: `packages/mcp-server` (the 52-tool contract) and
`agent-engine` (provider-agnostic agent loop; imports **nothing** from the product).

## 2. First 30 minutes (cold start)

Prerequisites: Node 20+, pnpm 10 (`packageManager` is pinned in `package.json`),
Docker (for Postgres 16), and an SSH key on the `king-kanda` GitHub account for
push.

```bash
git clone git@github.com:king-kanda/palda_cx_template.git
cd palda_cx_template
pnpm install

cp .env.example .env
# edit the four secrets: AUTH_SECRET, ENCRYPTION_KEY, INTERNAL_SECRET, MCP_TOKEN_SECRET
# everything else works with the mock defaults

docker compose up -d          # Postgres 16 on localhost:5432
pnpm db:migrate               # schema + btree_gist + exclusion constraint + RLS
pnpm db:seed                  # Palda Gardens demo tenant
```

Then, in three terminals:

```bash
pnpm dev          # web        → http://localhost:3000
pnpm dev:engine   # agent      → http://localhost:3100
pnpm dev:worker   # pg-boss jobs
```

Log in at `http://localhost:3000/login`:

| Role | Email | Password |
|---|---|---|
| Owner | `owner@palda.co.ke` | `owner1234` |
| Staff | `staff@palda.co.ke` | `staff1234` |

Tenant slug: `palda`. WhatsApp and M-Pesa default to **mock** mode, and the agent
falls back to a deterministic mock model when `OPENROUTER_API_KEY` is empty, so
the whole flow is explorable offline.

## 3. Verify before touching anything

```bash
pnpm verify            # typecheck → test-typecheck → unit tests → mock evals → build
pnpm test:integration  # needs Postgres; seeds, books, proves overlap rejection
```

Expected today: `verify` green; the integration test is skipped automatically when
`DATABASE_URL` is unset.

The Phase 1 gate (`pnpm db:migrate && pnpm db:seed && pnpm test:integration`) ran
successfully on 2026-11-09 against PostgreSQL 16: **4/4 integration tests
passed**, including the DB overlap rejection (`SLOT_UNAVAILABLE` from
PostgreSQL `23P01` on `resource_occupancy_no_overlap`) and the DPA-erasure test.
The seeded owner/staff credentials were verified and the dashboard rendered with
an owner session.

The full integration suite now also covers money, MCP approvals and Phase 3:
**35/35 passed on 2026-11-11** (4 booking/DPA, 7 money incl. the Tuma callback
shape, 10 MCP tenancy/scope/approval, 5 WhatsApp webhook flow, 5 Nairobi
reminders/digest, 4 agent-service staff routes). Docker Compose was verified
separately on 2026-11-09; see [`STATUS.md`](./STATUS.md).

## 4. Repo map

```
apps/
  web/            Next.js: dashboard, bookings, calendar, customers, invoices,
                  expenses, reviews, approvals, wambo inbox/settings, settings,
                  /api/mcp, /api/mpesa/callback, scripts/seed.ts
  agent-service/  Hono: /webhooks/whatsapp, /internal/chat, /internal/digest,
                  /internal/conversation/:id, /events
  worker/         pg-boss queues and schedules
agent-engine/     loop, guard, MCP client, llm adapters, evals, scenarios
packages/
  db/             Drizzle schema (32 tables), migrations, withTenant, loadEnv
  services/       ALL domain logic: bookings, availability, pricing, invoices,
                  payments, reminders, CRM, approvals, conversations, reports,
                  digest, expenses, settings, extras (vertical tools), seed
  mcp-server/     tool definitions, dispatch/gating/approvals, stateless server,
                  token issuance
  integrations/   WhatsApp Cloud API, M-Pesa via Tuma/Daraja, AES-GCM crypto,
                  meetings, lazy PDF
  verticals/      venue | salon | dental | consultancy presets
tests/            unit + Postgres-gated integration
docs/             tool-contract.md, runbook.md, STATUS.md, HANDOFF.md
```

Key entry points:

| Concern | File |
|---|---|
| Schema (source of truth) | `packages/db/src/schema.ts` |
| Tenant-scoped transaction / RLS | `packages/db/src/client.ts` (`withTenant`) |
| DB guarantees (overlap, RLS) | `packages/db/migrations/0001_tenancy_and_overlap.sql` |
| Service context / settings | `packages/services/src/context.ts` |
| Booking + overlap mapping | `packages/services/src/bookings.ts` |
| Money | `packages/services/src/pricing.ts`, `invoices.ts`, `payments.ts` |
| Approvals | `packages/services/src/approvals.ts`, `approval-executor.ts` |
| MCP gating and approvals | `packages/mcp-server/src/dispatch.ts` |
| Tool contract | `packages/mcp-server/src/tools.ts` + `docs/tool-contract.md` |
| Agent loop / guard | `agent-engine/src/run.ts`, `guard.ts` |
| Wambo turn orchestration | `apps/agent-service/src/run-service.ts` |
| WhatsApp routes / listener | `apps/agent-service/src/app.ts` (testable Hono app), `index.ts` (listener) |
| Jobs | `apps/worker/src/index.ts` |

## 5. Invariants — do not break these

1. **`tenant_id` + RLS on every table.** Anything new gets `tenant_id`, an RLS
   policy, and goes through `withPrincipal`/`withTenant`. `tenants` is the only
   table with open `SELECT` (routing metadata).
2. **Double booking is prevented by the database.** All occupancy goes through
   `resource_occupancy`; the GiST exclusion constraint is the final authority.
   Never rely on an application-level "check then insert".
3. **The model never computes money, availability or dates.** Tools return
   figures; the guard rejects any KES amount not present in a tool result.
4. **Sensitive writes never execute for customers or system principals.** They
   create approvals. Only an owner executes refunds/discounts/overrides.
5. **UI and MCP share `packages/services`.** No business logic in route
   handlers, server actions or tool handlers.
6. **`agent-engine` imports nothing from `@garden/*` product packages** except
   its own types. It talks to the app only through the `ToolGateway` seam.
7. **Money is integer KES.** Timestamps are `timestamptz` (UTC); display and
   wall-clock maths use `Africa/Nairobi` helpers in `packages/services/src/tz.ts`.
8. **Mock-first integrations.** WhatsApp, M-Pesa and meetings must keep working
   with no credentials.

## 6. Common workflows

### Add or change a tool

1. Implement the business function in `packages/services`.
2. Add the definition in `packages/mcp-server/src/tools.ts` with tier, scopes and
   `principalTypes`.
3. Update `docs/tool-contract.md`.
4. Add/extend a mock scenario in `agent-engine/src/scenarios.ts` if the agent
   should use it.
5. `pnpm verify`.

### Change the schema

```bash
# edit packages/db/src/schema.ts
pnpm db:generate     # new 000N_*.sql + snapshot
pnpm db:migrate
```

If the change adds a table, add it to the RLS table array in
`0001_tenancy_and_overlap.sql` (or a new migration) and give it a policy.

### Run the agent against a real model

```bash
# .env
OPENROUTER_API_KEY=...
WAMBO_MODEL=anthropic/claude-sonnet-4.5
pnpm eval            # real loop; needs network
```

### Issue an MCP token

```bash
pnpm --filter @garden/mcp-server issue-token -- --tenant palda --type staff --email owner@palda.co.ke
pnpm --filter @garden/mcp-server issue-token -- --tenant palda --type customer --phone +254712345678
pnpm --filter @garden/mcp-server issue-token -- --tenant palda --type system --label ops
```

## 7. Testing map

| Suite | Command | Needs DB? | Covers |
|---|---|---|---|
| Unit | `pnpm test` | No | pricing, Nairobi time, guard rails, tool contract/tiers, presets |
| Agent scenarios | `pnpm eval:mock` | No | tool choice, grounding, approvals, handoff, injection, verticals |
| Integration | `pnpm test:integration` | Yes | seed, quote, DB overlap rejection, DPA erasure (PII cleared, booking kept, audit written) |
| Full gate | `pnpm verify` | No | typecheck + test typecheck + unit + evals + build |

## 8. Git / remote

- Branch: `main`; remote: `origin` = `git@github.com:king-kanda/palda_cx_template.git`.
- Commit style used so far: one descriptive commit per working session
  (`Initial commit: Garden Booking OS (code-complete, unverified)`).
- Before pushing: `pnpm verify` must be green. Do not commit `.env`.
- CI: `.github/workflows/ci.yml` runs `pnpm verify` on every push/PR and a second
  job with Postgres 16 that runs `pnpm db:migrate && pnpm test:integration`.
  The integration job has never run on GitHub yet; the first PR will exercise it.

## 9. Security / operations notes

- `ENCRYPTION_KEY` protects integration secrets and `customer_sensitive` rows.
  Back it up; rotating it without re-encryption loses data.
- Superusers bypass RLS. Production should connect as a dedicated non-superuser
  role (SQL in `docs/runbook.md`). The worker and agent service need a
  privileged role to route webhooks before a tenant context exists.
- MCP tokens are per-tenant JWTs. Re-issue after staff deactivation; the server
  re-checks the user/customer row on every call.
- Approvals expire after 24h; expired approvals do not execute.
- DPA erasure is owner-only (`eraseCustomerData`): it anonymises the customer and
  removes sensitive rows/transcripts but keeps financial totals. Residual
  risk: old `audit_log`/`agent_runs` payloads can still reference conversation
  ids; review before a real DPA request.
- WhatsApp and M-Pesa callbacks are idempotent (wa message id, M-Pesa receipt).

## 10. Known gaps / where to start next

Ordered; full detail in `STATUS.md`:

1. Run the Phase 1 gate on real Postgres (migrate, seed, integration test).
2. M-Pesa sandbox STK + callback replay (Phase 2).
3. MCP tenant/scope/approval checks against a real DB (Phase 3).
4. OpenRouter spike; real-model eval run (Phase 4).
5. Per-vertical/admin/ops eval sets are mock-only today (18 scenarios); run them against a real model.
6. Phase 6: quote nudges and the 2-week pilot shadow mode (CRM segments, CSV export and the DPA erasure path are done).
7. Answer PLAN §11 owner questions before the pilot.

## 11. Code review checklist

- [ ] Every new table has `tenant_id`, a policy, and an index/constraint as needed.
- [ ] Every mutating path writes `audit_log`.
- [ ] Sensitive writes are `write-sensitive` and approval-gated for customer/system.
- [ ] Money/date figures in agent replies come from tools (guard coverage).
- [ ] Tool args are strict Zod objects; unknown fields rejected.
- [ ] No product imports inside `agent-engine`.
- [ ] Mock modes still work without credentials.
- [ ] `pnpm verify` green; `docs/tool-contract.md` updated.
