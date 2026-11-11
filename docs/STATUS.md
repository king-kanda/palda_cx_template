# Build Status

> Last updated: 2026-11-11. Written for any agent or human picking this project up cold.
> Source of truth for the plan is `PLAN.md` (§9 = phases). This file records **where the build actually is**.
> Cold-start instructions live in [`HANDOFF.md`](./HANDOFF.md).

## TL;DR

**Gated position: Phase 2.** Phase 1 passed on 2026-11-09: migrations, seed and `pnpm test:integration` ran against a real PostgreSQL 16 instance, seeded owner/staff credentials verified, and the dashboard rendered with an owner session. Phase 2 (M-Pesa sandbox) is the next gate; external sandboxes are still unavailable here.

**Code position: ahead of the gates.** Phases 1-5 are written, the three agent roles exist (`wambo`, `admin`, `ledger-digest`), all four vertical presets ship, and the Phase 6 conveniences are partly written. Phase 6's pilot itself is not started.

Treat code beyond Phase 1 as **written but unverified against infrastructure** until its acceptance test runs, with one exception: Phase 3's webhook, reminder and approval behaviour passed against Postgres in mock mode on 2026-11-11.

## Phase table

| Phase | Scope | Code | Acceptance test passed | What's missing |
|---|---|---|---|---|
| 1. Core app | resources/offerings/bookings, overlap constraint, availability, calendar, customers, dashboard | Written | **Yes — 2026-11-09** | PostgreSQL 16: `pnpm db:migrate`, `pnpm db:seed`, `pnpm test:integration` (4/4), seeded owner/staff login, dashboard 200. Docker Compose verified 2026-11-09 |
| 2. Money | pricing, invoices + PDF, payments, expenses/P&L, M-Pesa STK + callback | Written | **No** | Tuma sandbox run; callback replay idempotency check |
| 3. WhatsApp / reminders / MCP / approvals | webhook, inbox, pg-boss, `docs/tool-contract.md`, MCP server, approvals | Written | **Yes (mock) — 2026-11-11** | Postgres-backed webhook dedupe, consent, takeover, turn cap, Nairobi reminder times and digest content all pass; wrong-tenant/scope rejection and approval conversion pass. A real WhatsApp Cloud API send and a real-model turn remain. |
| 4. Agent engine + Wambo | loop, MCP gateway, guard, context, run log, tracing, evals | Written | **No** | OpenRouter spike (PLAN §6.6, "first task") not done; mock evals only; no real-model run; no stub-MCP second-vertical test |
| 5. Admin + ops agents | staff chat, events, `ledger-digest`, ops propose mode | Written | **No** | Admin/ops/tenancy evals now include pending approvals, bulk send, tenant isolation and capacity in mock form; still need a real-model run. Staff chat and digest delivery are verified in mock (4 tests). Agent definitions live in code modules rather than `agents/<id>/agent.json` folders (decision recorded below) |
| 7. Salon | duration slots, stylists, walk-ins (`walkins.join_queue`) | Preset + tool | **No** | Salon eval set now includes a mock scenario; needs real-model run |
| 8. Dental | dentist+chair, recalls (`recalls.schedule`), sensitive data | Preset + tool | **No** | Privacy eval (`dental-privacy`) added in mock form; needs real-model run |
| 9. Consultancy | meeting links (`meetings.create_link`, auto on confirm), intake (`intake.send_form`), packages | Preset + tools | **No** | Confidentiality eval added in mock form; verify link on real confirm |
| 6. Pilot | reviews polish, CRM segments, CSV export, 2-week shadow mode | Partial | **No** | CRM segments, CSV export and DPA erasure are written; the 2-week shadow mode needs the real garden |

(PLAN.md lists phases 7-9 before 6 in the text; numeric order above is by dependency.)

## What is verified in this environment

Run with `pnpm verify` (typecheck + test typecheck + unit tests + mock evals + production build):

- `pnpm typecheck` — all 9 packages/apps pass
- `pnpm test` — 40 unit tests pass (no DB)
- `pnpm eval:mock` — 18 deterministic agent scenarios pass
- `pnpm build` — production Next build succeeds (23 routes, including the CSV export route)

Phase 1 gate, run on 2026-11-09 against a temporary embedded PostgreSQL 16 server:

- `pnpm db:migrate` — both migrations applied, including `btree_gist`, the
  `resource_occupancy_no_overlap` exclusion constraint and RLS policies
- `pnpm db:seed` — Palda demo tenant: 8 customers, 5 resources, 5 offerings, 10 bookings, 9 invoices, 9 payments
- `pnpm test:integration` — **4/4 passed**: tenant seed, quote, DB overlap rejection (`SLOT_UNAVAILABLE` from `23P01`), DPA erasure (PII cleared, booking kept, audit written)
- seeded credentials — `owner@palda.co.ke / owner1234` and `staff@palda.co.ke / staff1234` verified against the stored scrypt hashes
- `GET /login` — 200; `GET /dashboard` with an owner session — 200 and rendered the seeded business

Docker Compose stack, verified 2026-11-09 with `docker compose up --build` (Docker 29.9.2):

- image builds, including `pnpm install --frozen-lockfile` and the production Next build
- `migrate` one-shot exits 0: both migrations applied, `resource_occupancy_no_overlap` present, RLS enabled and forced on 32/32 tables, Palda demo tenant seeded
- `web` healthy (`/login` 200), `agent` healthy (`/health` ok), `worker` started with all 5 queues
- `docker compose run --rm migrate pnpm test:integration` inside the container: **20/20 passed** (3 files: `booking-overlap`, `money`, `mcp-approvals`)

After adding Tuma support on 2026-11-11, the suite was re-run against embedded PostgreSQL 16: **21/21 passed** (4 Phase 1, 7 money including the Tuma-shaped callback, 10 MCP). The Docker image was not rebuilt for that change.

Phase 3 coverage was added on 2026-11-11 against the same embedded PostgreSQL 16:

- `tests/integration/whatsapp-flow.test.ts` (5) — drives the real agent-service Hono routes: a duplicate webhook stores one inbound message and produces one agent run, the DPA consent line is sent first, a staff takeover keeps automation silent, the hourly turn cap creates a handoff instead of a model run, an image receipt is stored without a run, and a bad `X-Hub-Signature-256` is rejected with 401.
- `tests/integration/reminders.test.ts` (5) — reminders land at exact Nairobi-time offsets (hold nudge/deposit/‑7d/‑3d/‑1d/thank-you/review), nothing is due before `send_at`, dispatch sends in mock mode with a single `KES` prefix and the Nairobi event date, expired holds are released with reminders cancelled, and the 07:00 digest (04:00 UTC) is built from the Nairobi-local day with today's events and unpaid balances.

- `tests/integration/agent-internal.test.ts` (4) — `/internal/*` rejects a missing or wrong shared secret, a staff chat turn persists an `agent_runs` row under the staff principal, a user from another tenant is rejected, and the digest endpoint writes a staff alert.

Last full run: 2026-11-11 (**35/35 integration**, embedded PostgreSQL 16). Docker stack last verified 2026-11-09; the image predates Tuma and the Phase 3 fixes.

## Never verified

- Anything against real WhatsApp, the Tuma sandbox, OpenRouter or Langfuse
- The CI workflow has not run on GitHub yet

## Recent changes (2026-11-08 → 11-11)

- **Webhook commit ordering (2026-11-11):** the WhatsApp webhook now stores the inbound message, customer and conversation in a committed transaction before running the agent turn. Previously the turn ran inside that transaction, so `agent_runs` and conversation-linked tools hit FK failures on the shared pool for first-contact messages.
- **Digest query fix (2026-11-11):** `buildDailyDigest` used a raw `sql` fragment with a `Date`, which postgres.js cannot bind; it now uses `lt()`. The 07:00 digest query executes.
- **Template amount/time fix (2026-11-11):** `{{amount}}` is now the bare integer because every preset template already writes `KES`; this removes `KES KES 9,000`. Payment confirmations render the event date in `Africa/Nairobi` instead of UTC.
- **Tuma M-Pesa provider (2026-11-11):** `MPESA_MODE=tuma` authenticates against `api.tuma.co.ke`, sends STK pushes, and accepts Tuma's flat callback shape; Daraja and mock remain.
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

1. ~~Phase 1 gate~~ done. `docker compose up --build` runs the whole stack (see runbook §2a).
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
