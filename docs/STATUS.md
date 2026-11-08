# Build Status & Handoff

> Last updated: 2026-11-08. Written for any agent or human picking this project up cold.
> Source of truth for the plan is `PLAN.md` (§9 = phases). This file records **where the build actually is**.

## TL;DR

**Gated position: Phase 1.** `PLAN.md` says not to start a phase until the previous one passes its acceptance test. **No phase has passed its acceptance test**, because nothing has ever been run against a real database or external sandbox.

**Code position: ahead of the gates.** Phases 1-4 are written, Phase 5 is partly written, and the Phase 7-9 vertical presets exist. Phase 6 (pilot) is not started.

Treat all of the code as **written but unverified** until the Phase 1 checks below pass.

## Phase table

| Phase | Scope | Code | Acceptance test passed | What's missing |
|---|---|---|---|---|
| 1. Core app | resources/offerings/bookings, overlap constraint, availability, calendar, customers, dashboard | Written | **No** | Run migrations + `pnpm test:integration` against Postgres |
| 2. Money | pricing, invoices + PDF, payments, expenses/P&L, M-Pesa STK + callback | Written | **No** | Daraja sandbox run; callback replay idempotency check |
| 3. WhatsApp / reminders / MCP / approvals | webhook, inbox, pg-boss, `docs/tool-contract.md`, MCP server, approvals | Written | **No** | End-to-end run: dedupe, Nairobi reminder times, wrong-tenant/scope rejection, sensitive write becomes pending approval |
| 4. Agent engine + Wambo | loop, MCP gateway, guard, context, run log, tracing, evals | Written | **No** | OpenRouter spike (PLAN §6.6, "first task") not done; only 10 mock evals vs ~40 planned; no real-model run; no stub-MCP second-vertical test |
| 5. Admin + ops agents | staff chat, events, `ledger-digest`, ops propose mode | Partly | **No** | Agent configs live in code (`apps/agent-service/src/agent-config.ts`, `agent-engine/src/agents.ts`), not in `agents/<id>/agent.json` folders; admin/ops/tenancy injection evals thin or absent |
| 7. Salon | duration slots, stylists, walk-ins | Preset only | **No** | Salon eval set |
| 8. Dental | dentist+chair, recalls, sensitive data | Preset only | **No** | Privacy evals (no clinical advice, no sensitive data in prompts/logs) |
| 9. Consultancy | meeting links, intake, packages | Preset + `meetings.ts` | **No** | Confidentiality evals; verify meeting link on confirmation |
| 6. Pilot | reviews polish, CRM segments, CSV export, 2-week shadow mode | Reviews screen only | **No** | Not started; needs the real garden |

(PLAN.md lists phases 7-9 before 6 in the text; numeric order above is by dependency.)

## What the README claims is verified (not re-checked by the author of this file)

- `pnpm typecheck` passes
- `pnpm test` passes (32 unit tests, no DB)
- `pnpm eval:mock` passes 10/10 (deterministic mock model)
- `pnpm build` succeeds

## Never verified

- Migrations (`0000_breezy_stardust.sql`, `0001_tenancy_and_overlap.sql`), seed, and the GiST exclusion constraint / RLS on real Postgres
- `tests/integration/booking-overlap.test.ts` has never run
- Anything against real WhatsApp, M-Pesa Daraja sandbox, OpenRouter or Langfuse
- Docker/Postgres was unavailable when the code was written

## Recommended next steps, in order

1. `docker compose up -d`, `pnpm install`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm test:integration`. This is **the Phase 1 gate**; fix anything it exposes before building further.
2. Re-run `pnpm typecheck && pnpm test && pnpm eval:mock && pnpm build` to confirm the README's claims still hold.
3. Phase 2 gate: M-Pesa sandbox STK push, then replay the callback and confirm nothing changes.
4. Phase 3 gate: MCP tenant/scope rejection and approval-not-execution against a real DB.
5. Phase 4: do the OpenRouter spike, then grow evals toward ~40 incl. admin/ops/tenancy sets.
6. Move agent configs into `agents/<id>/agent.json` + `persona.md` to match PLAN §6.1/§10 (or record the decision to keep them in code).
7. Per-vertical eval sets (salon, dental privacy, consultancy confidentiality).
8. Answer the owner questions in PLAN §11 before the pilot.

## Repo / tooling state

- **Not a git repository** as of 2026-11-08 (no `.git` here or in any parent). No remote.
- Location is outside `batanat`, so this is a **personal** project: GitHub account `king-kanda`, SSH remote only.
- `.gitignore` is small (132 bytes); confirm it covers `node_modules`, `.env`, `.next` before the first commit.
- Intended next step once git is set up: `git init -b main`, first commit, private repo, SSH remote. Repo name not yet chosen.

## Maintenance rule

When a phase's acceptance test is actually run, update the table above: change "Acceptance test passed" to **Yes**, add the date and the command/evidence, and move the gated position forward.
