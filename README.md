# Garden Booking OS

A multi-tenant booking operating system for Kenyan service businesses — venues,
salons, dental practices and consultancies — with an AI concierge (Wambo),
WhatsApp and M-Pesa built in.

One codebase, configuration not forks: the vertical is a preset record, every
table carries `tenant_id`, and the same MCP tools serve every business.

## What is in the box

| Piece | Where | Notes |
| --- | --- | --- |
| **Booking app** | `apps/web` | Next.js 16 staff UI, server actions, PDF invoices, `/api/mcp`, `/api/mpesa/callback`. |
| **MCP server** | `packages/mcp-server` | 52 tenant-scoped tools (47 core + 5 vertical extras) over stateless Streamable HTTP, tiered + approval-gated. |
| **Agent engine** | `agent-engine` | Reusable Wambo engine: LLM loop, guard rails, evals, MCP client. Imports nothing from the product. |
| **Agent service** | `apps/agent-service` | WhatsApp webhook, Wambo turns, internal chat/digest endpoints, per-conversation locks. |
| **Worker** | `apps/worker` | pg-boss: reminders, hold expiry, approval expiry, 07:00 digest, events. |
| **Domain services** | `packages/services` | The only implementation of bookings, money, approvals, CRM, reporting. UI and MCP share it. |
| **Database** | `packages/db` | Drizzle schema (32 tables), migrations, tenant-scoped transaction helper. |
| **Verticals** | `packages/verticals` | Venue, salon, dental, consultancy presets: labels, hours, offerings, FAQ, reminders, agent hints. |
| **Integrations** | `packages/integrations` | WhatsApp Cloud API, M-Pesa Daraja, encryption, meetings, invoice PDF. |

## Design rules

1. **The database is the source of truth; the agent is a client.** The agent can
   do nothing a human with the same role could not do in the UI, because both
   call the same service functions.
2. **The model never computes money, availability or dates.** Tools do. The
   engine's guard rejects any KES figure that did not appear in a tool result.
3. **Humans own risk.** Refunds, discounts, out-of-policy cancellations and bulk
   sends from customers or agents become approvals; they never execute directly.
4. **Double booking is impossible at the database level.** `resource_occupancy`
   has a GiST exclusion constraint; PostgreSQL itself rejects overlaps.
5. **Tenant isolation everywhere.** Every table is `tenant_id`-scoped, RLS is
   enabled and forced, and `withTenant()` sets `app.tenant_id` per transaction.
6. **Kenya first.** Integer KES, `Africa/Nairobi` helpers (fixed +03:00), M-Pesa
   STK/C2B, WhatsApp, English/Swahili/Sheng.

## Quick start

```bash
cp .env.example .env          # set the four secrets
docker compose up -d          # Postgres 16
pnpm install
pnpm db:migrate               # schema + exclusion constraint + RLS
pnpm db:seed                  # Palda Gardens demo tenant

pnpm dev                      # web        → http://localhost:3000
pnpm dev:engine               # agent      → http://localhost:3100
pnpm dev:worker               # jobs
```

Sign in at http://localhost:3000/login with `owner@palda.co.ke` / `owner1234`
(staff: `staff@palda.co.ke` / `staff1234`, tenant slug `palda`).

No credentials needed to explore: WhatsApp and M-Pesa default to mock mode and
the agent falls back to a deterministic model when `OPENROUTER_API_KEY` is unset.

## Screens

Dashboard · Calendar · Bookings (list, new, detail with money actions, CSV export) ·
Customers and profiles (search, repeat/VIP/lapsed segments, data-protection erasure) ·
Invoices with PDF and M-Pesa matching · Expenses & P&L · Reviews · Approvals ·
Wambo inbox, thread and settings · Settings (policies, resources, packages, add-ons,
team, integrations).

## Verify it

```bash
pnpm typecheck          # all packages and apps
pnpm test               # 32 unit tests, no database
pnpm eval:mock          # 18 deterministic agent scenarios
pnpm build              # production Next build
pnpm test:integration   # needs Postgres; seeds, books, proves overlap rejection
```

`pnpm eval:mock` currently passes 18/18: availability + quote grounding, hold
semantics, approval-not-execution, handoff, ungrounded-price rejection, prompt
injection, admin unpaid report, refund/bulk-send approvals, pending-approval
visibility, digest numbers, plus salon booking, dental privacy, consultancy
meeting link, tenant isolation, Swahili and capacity rejection.

## Documentation

- [`docs/HANDOFF.md`](docs/HANDOFF.md) — cold-start setup, verification, repo map,
  invariants, review checklist.
- [`docs/STATUS.md`](docs/STATUS.md) — where the build is and what has actually
  been verified.
- [`docs/tool-contract.md`](docs/tool-contract.md) — tools, tiers, scopes,
  approvals, idempotency, error codes.
- [`docs/runbook.md`](docs/runbook.md) — environment, migrations, seeds,
  WhatsApp/M-Pesa setup, RLS roles, go-live checklist, troubleshooting.
- [`PLAN.md`](PLAN.md) — the product/architecture specification.

## Repository layout

```
apps/
  web/            Next.js staff app + MCP + M-Pesa webhook
  agent-service/  WhatsApp webhook and Wambo turns
  worker/         pg-boss jobs
agent-engine/     reusable agent engine (no product imports)
packages/
  db/             schema, migrations, withTenant
  services/       bookings, payments, invoices, approvals, CRM, reports
  mcp-server/     tool definitions, dispatch/gating, auth
  integrations/   WhatsApp, M-Pesa, crypto, meetings, PDF
  verticals/      venue | salon | dental | consultancy presets
tests/            unit + Postgres-gated integration tests
```

## Status

Code-complete against `PLAN.md` and verified by typecheck, 32 unit tests, 18
agent scenarios and a production build. The Phase 1 gate also passed on
2026-11-09 against PostgreSQL 16: migrations, seed, `pnpm test:integration`
(4/4), seeded login and a rendered dashboard. Remaining acceptance gates need
external sandboxes (M-Pesa Daraja, WhatsApp, OpenRouter) or the real pilot
garden; see [`docs/STATUS.md`](docs/STATUS.md).

Not in v1: staff WhatsApp channel (staff use the web inbox), payments other than
M-Pesa/cash/bank/card recording, and multi-currency.
