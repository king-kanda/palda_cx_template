# Build Status

> Last updated: 2026-11-09. Written for any agent or human picking this project up cold.
> Source of truth for the plan is `PLAN.md` (§9 = phases). This file records **where the build actually is**.
> Cold-start instructions live in [`HANDOFF.md`](./HANDOFF.md).

## TL;DR

**Gated position: Phase 1.** `PLAN.md` says not to start a phase until the previous one passes its acceptance test. **No phase has passed its acceptance test**, because nothing has ever been run against a real database or an external sandbox in this environment (Docker/Postgres are unavailable here).

**Code position: ahead of the gates.** Phases 1-5 are written, the three agent roles exist (`wambo`, `admin`, `ledger-digest`), all four vertical presets ship, and the Phase 6 conveniences are partly written. Phase 6's pilot itself is not started.

Treat all of the code as **written but unverified against infrastructure** until the Phase 1 checks in `HANDOFF.md` pass.

## Phase table

| Phase | Scope | Code | Acceptance test passed | What's missing |
|---|---|---|---|---|
| 1. Core app | resources/offerings/bookings, overlap constraint, availability, calendar, customers, dashboard | Written | **No** | Run migrations + `pnpm test:integration` against Postgres |
| 2. Money | pricing, invoices + PDF, payments, expenses/P&L, M-Pesa STK + callback | Written | **No** | Daraja sandbox run; callback replay idempotency check |
| 3. WhatsApp / reminders / MCP / approvals | webhook, inbox, pg-boss, `docs/tool-contract.md`, MCP server, approvals | Written | **No** | End-to-end run: dedupe, Nairobi reminder times, wrong-tenant/scope rejection, sensitive write becomes pending approval |
| 4. Agent engine + Wambo | loop, MCP gateway, guard, context, run log, tracing, evals | Written | **No** | OpenRouter spike (PLAN §6.6, "first task") not done; mock evals only; no real-model run; no stub-MCP second-vertical test |
| 5. Admin + ops agents | staff chat, events, `ledger-digest`, ops propose mode | Written | **No** | Admin/ops/tenancy evals now include pending approvals, bulk send, tenant isolation and capacity in mock form; still need a real-model run. Agent definitions live in code modules rather than `agents/<id>/agent.json` folders (decision recorded below) |
| 7. Salon | duration slots, stylists, walk-ins (`walkins.join_queue`) | Preset + tool | **No** | Salon eval set now includes a mock scenario; needs real-model run |
| 8. Dental | dentist+chair, recalls (`recalls.schedule`), sensitive data | Preset + tool | **No** | Privacy eval (`dental-privacy`) added in mock form; needs real-model run |
| 9. Consultancy | meeting links (`meetings.create_link`, auto on confirm), intake (`intake.send_form`), packages | Preset + tools | **No** | Confidentiality eval added in mock form; verify link on real confirm |
| 6. Pilot | reviews polish, CRM segments, CSV export, 2-week shadow mode | Partial | **No** | CRM segments, CSV export and DPA erasure are written; the 2-week shadow mode needs the real garden |

(PLAN.md lists phases 7-9 before 6 in the text; numeric order above is by dependency.)

## What is verified in this environment (no database, no network)

Run with `pnpm verify` (typecheck + test typecheck + unit tests + mock evals + production build):

- `pnpm typecheck` — all 9 packages/apps pass
- `pnpm test` — 32 unit tests pass (no DB)
- `pnpm eval:mock` — 18 deterministic agent scenarios pass (10/10 previously; added salon, dental privacy, consultancy, approvals, bulk send, tenant isolation, Swahili and capacity)
- `pnpm build` — production Next build succeeds (23 routes, including the CSV export route)

Last full run: 2026-11-09, after the DPA-erasure and eval-expansion changes.

## Never verified

- Migrations (`0000_breezy_stardust.sql`, `0001_tenancy_and_overlap.sql`), seed, the GiST exclusion constraint and RLS on real Postgres
- `tests/integration/booking-overlap.test.ts` has never run. It now also covers the DPA-erasure path (PII cleared, booking kept, audit written).
- Anything against real WhatsApp, M-Pesa Daraja sandbox, OpenRouter or Langfuse
- Docker/Postgres were unavailable when the code was written

## Recent changes (2026-11-08 → 11-09)

- **Environment loading:** `loadEnv()` in `packages/db/src/env.ts` finds the repo-root `.env` from any package cwd. Worker, agent service, web (`next.config.ts`), drizzle config, migrate CLI, seed and `issue-token` all use it; direct `dotenv` imports were removed from the apps.
- **Vertical extras implemented** (previously advertised by presets but missing): `addons.quote`, `meetings.create_link`, `intake.send_form`, `recalls.schedule`, `walkins.join_queue` — 52 tools total.
- **Consultancy meeting link** is created, stored on the booking and sent when a booking is confirmed (`confirmBooking`).
- **RLS-safe bootstrap paths:** login user lookup, MCP `principalFromClaims` and the settings team list run inside `withTenant`/`withPrincipal`; `tenants` has open `SELECT` with scoped writes.
- **PDF rendering** is lazy (`pdf-lazy.ts`) so plain Node/tsx processes do not boot `@react-pdf/renderer`.
- **DPA erasure path:** owners can erase a customer from the profile page. `eraseCustomerData` anonymises the customer row, deletes `customer_sensitive` rows and conversations/messages, clears booking notes/attributes, review comments and payment phone/raw payloads, and audits `customer.erased`. Financial totals survive for accounting (PLAN §7, §13.5).
- **CSV exports:** `/api/reports/export?type=bookings|invoices|payments` (UTF-8 BOM, formula-injection-safe); the bookings page links to it.
- **CRM segments:** `customersFor`/`listCustomers` accept `repeat`, `vip` (KES 100k+ lifetime) and `lapsed` (90 days); the customers page has a segment filter.
- **WhatsApp safety:** first contact gets a DPA consent line; `MAX_TURNS_PER_HOUR` (default 20) caps agent turns per conversation and hands off instead of looping.
- **Booking money columns:** `listBookings` now returns `paidKes` and `balanceKes` (sum of succeeded payments minus refunds) so list and export figures match the booking detail.

## Decision record: agent configs stay in code modules

`PLAN.md` §6.1/§10 sketches `agents/<id>/agent.json` + `persona.md`. This repo ships **base** agent definitions as typed modules (`agent-engine/src/agents.ts`) and treats per-tenant versions as **data** (`agent_versions`/`agent_pointers`, resolved by `apps/agent-service/src/agent-config.ts`).

Why: JSON/persona files would have to be read from disk at runtime and cannot be bundled reliably into Next/worker builds without a build step, which the repo deliberately avoids (`@garden/*` export `src/index.ts` directly). The engine remains "agent-as-data" for anything tenant-specific; only the immutable shipped defaults are code. Revisit if/when the engine is split into its own deployed repo (PLAN §10 permits the move).

## Recommended next steps, in order

1. `docker compose up -d`, `pnpm install`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm test:integration`. This is **the Phase 1 gate**; fix anything it exposes before building further.
2. Re-run `pnpm verify` to confirm the claims above still hold.
3. Phase 2 gate: M-Pesa sandbox STK push, then replay the callback and confirm nothing changes.
4. Phase 3 gate: MCP tenant/scope rejection and approval-not-execution against a real DB.
5. Phase 4: do the OpenRouter spike, then run the mock scenarios against a real model (`pnpm eval`).
6. Answer the owner questions in PLAN §11 before the pilot.

## Repo / tooling state

- Git repository on branch `main`, remote `origin` = `git@github.com:king-kanda/palda_cx_template.git` (SSH, private, personal project — no Batanat code).
- Initial commit `8d6964c` ("Initial commit: Garden Booking OS (code-complete, unverified)") contains the whole tree. The DPA/CSV/segment/eval work above is committed in the session-end commit; see `git log`.
- `.gitignore` covers `node_modules`, `.next`, `dist`, `.env`, logs and test artifacts.
- CI (`.github/workflows/ci.yml`) runs `pnpm verify`, plus a Postgres 16 job for
  migrations and `pnpm test:integration`. It has not run on GitHub yet.

## Maintenance rule

When a phase's acceptance test is actually run, update the table above: change "Acceptance test passed" to **Yes**, add the date and the command/evidence, and move the gated position forward.
