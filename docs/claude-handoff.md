# Claude Handoff — Palda CX / Wambo

> Last updated: **2026-11-15**
> Written by: Claude (build agent) for the next engineer or agent picking this up cold.
> Companion docs: [`../PLAN.md`](../PLAN.md) (what it should be), [`STATUS.md`](./STATUS.md) (gate evidence),
> [`HANDOFF.md`](./HANDOFF.md) (cold-start/runbook), [`ACTION-ITEMS.md`](./ACTION-ITEMS.md) (what the owner must provide),
> [`tool-contract.md`](./tool-contract.md) (MCP contract), [`DESIGN-SYSTEM.md`](./DESIGN-SYSTEM.md) (UI style guide and design tokens).

---

## 1. Executive summary

The product is **code-complete for Phases 1–9 plus the Phase 6 conveniences**, and it runs end to end in
mock mode on one codebase. It is **not yet production-proven**: only two gates have passed — Phase 1 on real
PostgreSQL (2026-11-09) and Phase 3 in mock mode (2026-11-11). Every real-provider path (Tuma M-Pesa, WhatsApp
Cloud, OpenRouter) is still unverified because the keys/host are not available in this environment.

What that means in practice:

- You can demo the venue, salon, dental and consultancy verticals today on one codebase.
- You cannot yet hand the system to a real dental clinic or a field-service company as a production service.
- A new tenant is created by the seed CLI, not by self-serve signup (self-serve is explicitly deferred in `PLAN.md`).

Last verification run in this environment (2026-11-15):

| Check | Result |
|---|---|
| `pnpm typecheck` | **9/9 packages/apps pass** |
| `pnpm test` | **74/74 unit tests pass** (9 files) |
| `pnpm eval:mock` | **40/40 agent scenarios pass** |
| `pnpm build` | **production build succeeds**, 24 routes |
| `pnpm test:integration` | **49/49 passed on 2026-11-15** (8 files) on a throwaway `garden_test` database inside the Docker Postgres, after the onboarding, cleaning and UI changes |

Docker: the stack was rebuilt on **2026-11-15** from the current working tree (see §7a) and all four app
containers plus Postgres came up healthy. Docker 29.9.2 is installed on this machine.

Git state: last commit `097b9f7` ("Add consultancy intake form, ops agent propose mode and quote nudges").
The working tree has an uncommitted batch of **42 files, +2,283 / −783** (details in §8). `.env` is gitignored
and must never be committed.

---

## 2. Phase / gate status

| Phase | Scope | Code | Acceptance | Still needed |
|---|---|---|---|---|
| **1. Core app** | resources, offerings, bookings, DB overlap constraint, availability, calendar, customers, dashboard | Done | ✅ **Passed 2026-11-09** on PostgreSQL 16: migrate, seed, overlap rejection (`SLOT_UNAVAILABLE` / `23P01`), DPA erasure, seeded logins, dashboard 200 | — |
| **2. Money** | pricing/quotes, invoices + PDF, payments, expenses/P&L, M-Pesa STK + callback with idempotency | Done (Tuma + Daraja + mock) | ⏳ **Not passed** | `TUMA_EMAIL`, `TUMA_API_KEY`, public HTTPS callback, test phone; then `pnpm smoke:mpesa` + callback replay |
| **3. WhatsApp / reminders / MCP / approvals** | webhook, message store, staff inbox/takeover, templates, pg-boss reminders, 53-tool MCP server, approvals queue | Done | ✅ **Passed in mock 2026-11-11**; integration covers dedupe, consent line, takeover, turn cap, reminder offsets, wrong-tenant/scope rejection | Real WhatsApp Cloud send + real-model turn |
| **4. Agent engine + Wambo** | loop, MCP gateway, guard, context, run log, tracing, evals | Done | ⏳ **Not passed** | `OPENROUTER_API_KEY`; real-model eval run (the "first task" OpenRouter spike is still open) |
| **5. Admin + ops agents** | staff chat, events, `ledger-digest`, `ops` in propose mode | Done | ⏳ **Not passed** | Real-model run; staff chat + digest are mock-verified only |
| **6. Reviews / follow-ups / pilot** | review flow + low-score alerts, quote nudges (+24h/+72h), CRM segments, CSV exports, shadow mode | Done except pilot | ⏳ **Not passed** | 2-week shadow pilot with the real garden; real WhatsApp/M-Pesa |
| **7. Salon** | duration slots, stylists/stations, walk-ins (`walkins.join_queue`) | Preset + tool + eval | ⏳ **Not passed** | Real-model acceptance + real salon data |
| **8. Dental** | dentist + chair, treatments, recalls (`recalls.schedule`), sensitive data | Preset + tools + privacy eval | ⏳ **Not passed** | Real-model acceptance, DPA adviser sign-off, pilot clinic data |
| **9. Consultancy** | consultant resources, session types, meeting links, public intake form, packages | Preset + tools + UI | ⏳ **Not passed** | Real confirm/meeting-link test, real-model acceptance, pilot data |

There is no Phase 10. The priority order is: Phase 2 → Phase 4/5 real-model → Phase 6 pilot → phases 7–9 pilots.

---

## 3. Is the CX engine ready?

**Yes as software; no as a proven production system.**

What exists:

- `agent-engine/` is provider-agnostic and imports **nothing** from `@garden/*` product packages. It talks to the
  app only through the `ToolGateway` seam.
- Four agent configs: `wambo` (customer), `admin` (staff), `ledger-digest` (scheduled, read-only),
  `ops` (queue watcher, must **propose** via `approvals.request`, never execute a write).
- MCP contract: **53 tools** (`packages/mcp-server/src/tools.ts`), with tiers (`read`, `write-safe`,
  `write-sensitive`, `escalate`), scopes, principal types, Zod-strict args, tenant isolation and idempotency.
- Safety/guardrails:
  - money grounding (every `KES` figure must exist in a tool result),
  - date grounding (explicit ISO / `20 December 2026` / `20/12/2026` dates must exist in a tool result),
  - link allowlist (only own domain, pay/review links, or links returned by a tool),
  - PII and forbidden-promise checks, repeat/resend guard,
  - per-agent tool grants enforced **at execution time**, not only when listing tools,
  - per-turn tool-call caps (`maxToolCalls`) with handoff,
  - duplicate tool-call blocking, failure-count handoff,
  - regenerate-once behaviour for non-mock adapters before the safe fallback,
  - untrusted-content fencing and injection evals.
- Shadow mode for the Phase 6 pilot: model-authored customer replies become `message_review` approvals and are
  **not sent** until a staff member approves; the thread shows `[Draft awaiting approval] …`.
- **40/40 deterministic mock evals** cover availability, quotes, holds, cancellation policy, handoffs, Swahili and
  Sheng, capacity, double-booking, price negotiation, refunds/legal threats, angry complaints, date ambiguity,
  payment lag, reschedule approvals, date/link guards, tool caps/failures, admin approval limits, review
  injection, tenant isolation, ops read-only, and duplicate resend.

What has not happened:

- No real-model turn (mock adapter only).
- No real WhatsApp send.
- No real M-Pesa payment or callback.
- No 2-week shadow pilot.

---

## 4. Are Dental (and the other verticals) ready?

All four verticals ship as **presets + data + tools with zero engine changes** (the §6.9 acceptance test also
passes against a stub MCP server for a different vertical).

| Vertical | Ready to demo? | What ships | Not ready yet |
|---|---|---|---|
| **Venue** (pilot) | Yes | Parent/child spaces (Whole Garden + sub-spaces), packages, add-ons, capacity, range bookings, blocks, venue templates | Real garden data, real WhatsApp/M-Pesa |
| **Salon** | Yes | Stylists/stations, duration slots, buffers, walk-ins, salon templates | Real-model run, pilot salon's services/hours/policies |
| **Dental** | Yes | Dentists + chairs/rooms, treatment offerings, 1-day reminders, 6-month recalls, encrypted `customer_sensitive` data, clinical-advice handoff, privacy eval | Real-model run, DPA adviser sign-off, pilot clinic data |
| **Consultancy** | Yes | Consultants, session types, online meeting links, public `/intake/<tenant>/<bookingId>` form, packages/retainers | Real confirm/meeting-link test, real-model run, pilot data |
| **Cleaning & home services** (new 2026-11-15) | Yes | Crews, 5 services (standard/deep/move-in-out/office/sofa-carpet), 6 add-ons, per-job visit address + property type + frequency + access notes, 30-min travel buffer before each job, Mon–Sat hours, day-before reminder, post-job review request, 2-week rebook nudge, demo tenant `sparkle` | No routing, zone pricing or dispatch; address is optional at schema level (the staff form requires it); real-model run; real crew/service data |

### Dental specifics

- Preset: `packages/verticals/src/dental.ts`; resource kinds `staff` + `room`; offerings Consultation (30 min),
  Scaling & Polishing (45), Filling (45), Root Canal (90); working hours Mon–Fri.
- Reminders: `appointment_minus_1d` (−24h) and `recall_6m` (+4,320h).
- Sensitive data: encrypted in `customer_sensitive`, never included in prompts/traces by default; staff-only
  `customers.sensitive.get`; audit records field names only.
- The customer agent is instructed to schedule only — no diagnosis or clinical advice; those become handoffs.
- Deliberate non-goals for v1: clinical records, prescriptions, insurance/SHA claims.

**Dental is not "production-ready for a real clinic" until the DPA/consent position is signed off and a real-model
privacy run passes.** Also note that a clinic cannot self-onboard; create its tenant with the seed CLI.

---

## 5. Are staff / "service workers" ready to use it?

The phrase is ambiguous, so here is the state by interpretation:

- **Staff/employees using the platform:** yes. There are `owner` and `staff` logins; staff get the web inbox/chat
  (v1 is web-only; there is no staff WhatsApp channel by design) and can use bookings, calendar, customers,
  invoices/payments, approvals, reviews and the Wambo inbox. Owner-only enforcement exists in the service layer
  for settings changes; the UI does **not** currently hide owner-only screens, so staff can open Settings but the
  save fails.
- **Field/home-service businesses:** **partly.** `cleaning` covers jobs at a customer address with crews, a travel
  buffer and addressed reminders. Plumbers/electricians/etc. would reuse the same pattern but still need routing,
  zone pricing, dispatch and parts, which do not exist.
- **Background worker service:** yes. `apps/worker` runs pg-boss queues for reminders, hold expiry, approval
  expiry, the 07:00 Nairobi digest, event forwarding and the two-hourly ops scan.
- **PWA service worker / offline mode:** no.

---

## 6. Build stages (chronology)

Approximate order of the work; dates are the recorded gate/verification dates.

1. **Foundation (2026-11-08/09).** Plan, monorepo, Drizzle schema (32 tables), tenancy + RLS, `btree_gist`
   exclusion constraint, tenant-scoped transactions, auth/session, seed.
2. **Core app — Phase 1 (gate 2026-11-09).** Resources/offerings/bookings, DB-level overlap rejection,
   availability grid, calendar, customers, dashboard, invoice skeleton. Real PostgreSQL 16 gate passed.
3. **Money — Phase 2 (code).** Pricing/quotes, invoices + lazy PDF, manual payments, expenses/P&L, M-Pesa
   adapter. Daraja and mock shipped first; **Tuma** added 2026-11-11 (token auth, STK push, callback
   auto-detection, replay/idempotency tests), plus `scripts/mpesa-smoke.ts` and `pnpm smoke:mpesa`.
4. **WhatsApp / reminders / MCP / approvals — Phase 3 (mock gate 2026-11-11).** Webhook dedupe, consent line,
   staff takeover, hourly turn cap, pg-boss reminders at Nairobi offsets, 53-tool MCP server with scope checks,
   approvals queue and executor.
5. **Agent engine + Wambo — Phase 4.** Loop, MCP gateway, guard, context assembly, run log, Langfuse hook,
   deterministic mock adapter, eval harness. Stub-MCP second-vertical acceptance added.
6. **Admin + ops agents — Phase 5.** Staff chat, `ledger-digest`, `ops` propose mode, `/internal/*` routes,
   worker `ops.scan`, daily digest.
7. **Verticals — Phases 7–9.** Salon (walk-ins), dental (recalls, sensitive data, privacy eval), consultancy
   (meeting links, intake form, packages). All as presets + tools, no engine changes.
8. **Phase 6 conveniences.** Reviews + low-score alerts, quote nudges (+24h/+72h), CRM segments, CSV exports,
   DPA erasure, then shadow mode (draft replies held for staff approval).
9. **Hardening + current batch (2026-11-12 → 11-15).** Execution-time tool grants, `maxToolCalls` on all four
   agents, regenerate-once, date grounding, link allowlist, `reviews.list`, integration suite to 40 tests, eval
   suite from 21 to 40 scenarios. UI refresh in the working tree: new app shell, redesigned login/dashboard/inbox,
   calendar month/week/day + drag-to-reschedule, invoice STK form + unmatched-receipt matching, customer reviews.
   **Design system adopted from palda-homes (2026-11-15)**: tokens, Plus Jakarta Sans, sidebar/top-bar shell,
   split-screen login, KPI/hero tiles and pill/table/input/button styles, applied app-wide; the Wambo inbox was
   rebuilt as a WhatsApp Web style two-pane chat. Documented in [`DESIGN-SYSTEM.md`](./DESIGN-SYSTEM.md).
10. **Not started: real-provider acceptance and pilot.** That is the next stage.

---

## 7. The last thing built

**Last completed coding step (2026-11-15): eval and guard hardening.**

- Expanded `agent-engine/src/scenarios.ts` from 21 to **40 scenarios**: double-booking, price negotiation,
  Sheng, refund/legal threat, angry complaint, date ambiguity, payment lag, reschedule approval, date/link
  guard, tool cap, tool failures, admin no-confirm, admin cannot approve, review injection, admin tenant
  isolation, ops read-only, ops no-bulk-send, duplicate resend.
- Tightened `checkDatesGrounded` in `agent-engine/src/guard.ts`: an explicit calendar date is now rejected even
  when no tool returned any date (previously the check was skipped when the grounded-date set was empty).
- Registered the new scenarios on the four agent configs in `agent-engine/src/agents.ts`.
- Verified: typecheck 9/9, unit **59/59**, mock evals **40/40**, production build green (24 routes).

**Also in the uncommitted working tree** (built across the same period, not yet committed):

- Shadow mode: `TenantSettings.shadowMode`, `message_review` approval kind, executor sends the approved draft,
  WhatsApp + `/internal/reply` paths hold drafts, Wambo settings toggle.
- Engine: tool-policy execution guard, `maxToolCalls` on all agents, regenerate-once, link allowlist, date guard.
- Services/MCP: `reviews.list`, customer profile returns reviews + average rating (nullable ratings handled),
  ops agent, quote nudges, consultancy intake.
- Web UI: new `components/shell.tsx` (collapsible sidebar, mobile drawer, Wambo/approvals icon links, user menu;
  it **replaces the deleted `components/nav.tsx`**), redesigned login/dashboard/Wambo inbox (`chat-list.tsx`,
  `thread-client.tsx`), `components/ui.tsx` and `globals.css` rebuilt on the palda-homes design tokens, calendar
  month/week/day + drag-to-reschedule (`calendar/drag.tsx`), invoice M-Pesa STK form + unmatched-receipt
  matching, customer review display. Every page's hard-coded orange/stone/Tailwind-hue colours were mapped to the
  new tokens (map in `DESIGN-SYSTEM.md` §8).

### 7a. Docker status (updated 2026-11-15)

- The image `garden-booking-os:local` and the stack (`garden_db`, `garden_migrate`, `garden_web`, `garden_agent`,
  `garden_worker`) were **rebuilt from the current working tree**, so the image now includes Tuma, intake, the ops
  agent, shadow mode and the UI refresh including the new design system and WhatsApp-style inbox.
- Command: `docker compose up -d --build` from the repo root. Web is on `http://localhost:3000`, agent on `:3100`,
  Postgres on `:5432`. After the rebuild `garden_web`, `garden_agent` and `garden_db` reported healthy,
  `garden_worker` was up, `garden_migrate` exited 0 (migrate + seed), and `/login` returned 200.
- Each UI change needs another `docker compose up -d --build`; the compose file builds from the source tree and
  does not mount it, so a running container never shows newer edits.
- The earlier stack failure (containers "Exited (1)" five days earlier) was a plain `SIGTERM` stop, not a crash.
- Not verified in the container: the integration suite (`docker compose run --rm migrate pnpm test:integration`)
  was not re-run against the new image, and the pages were not checked in a browser after the rebuild.

### 7b. Onboarding, cleaning vertical and UI fixes (2026-11-15)

**Self-serve onboarding** (`/onboarding`, linked from the login page): a 5-step wizard (business type → business details →
team & services → hours & policies → owner account) backed by `createBusiness()` in `packages/services/src/onboarding.ts`.

- Creates tenant, vertical, config (policies/business/brand), owner, resources, offerings and the preset add-ons in one
  transaction, with **no demo customers or bookings**. It then signs the owner in and opens the dashboard with a
  Getting-started card. The tenant id is generated first and the RLS tenant context set before the tenant insert, so it
  also works under the restricted application role (the integration tests run as superuser and cannot prove this part).
- FAQ is generated per business: preset entries flagged `needsReview` (e.g. "We are in Karen", "parking for 80 cars")
  are skipped, and the location and cancellation answers are built from what the owner typed.
- **Access control:** `ONBOARDING_CODE` set → enabled and the wizard asks for the code; `ONBOARDING_ENABLED=true` →
  open; otherwise open outside production and closed in production. `docker-compose.yml` defaults it to open for demos.
  There is **no rate limiting, email verification or CAPTCHA**, so do not leave it open on the public internet.
- **Sign-in is email + password only; nobody types a workspace name.** `findAccountsByEmail()` (`accounts.ts`) looks the
  email up inside each business’s own tenant context (users are RLS-protected, so a cross-tenant query would see nothing
  under the restricted role). That is one small query per business, run in batches of 8, which is fine for hundreds of
  businesses; beyond that add an email → tenant index table kept by a trigger. Onboarding **refuses an email that is already
  registered**, so one email maps to one business; if the same email *and* password ever exist in two businesses (e.g. via
  the seed CLI), login refuses with a contact-support message instead of guessing. Suspended tenants (`status != active`) can
  no longer sign in.
- The tenant `slug` still exists internally (public intake links `/intake/<slug>/<id>`, callback URLs, `DEFAULT_TENANT_SLUG`
  for the agent service) but is generated from the business name, made unique, and never shown or typed.
- Verified against the running Docker stack by posting the real form requests (not by clicking): the onboarding action creates
  a business, returns a redirect to `/dashboard?welcome=1` with a session, the new dashboard/new-booking/settings pages render
  with the vertical’s wording, a second signup with the same email is refused, and the new owner can sign in with email
  only. **Not verified:** the wizard’s step-by-step client UI in a real browser (button states, validation hints).
  Working hours can only be set in the wizard today; Settings has no hours editor.

**Cleaning preset** (`packages/verticals/src/cleaning.ts`, id `cleaning`): see §4. Demo: business "Sparkle Cleaners",
`owner@sparkle.co.ke` / `owner1234`, `staff@sparkle.co.ke` / `staff1234`, 3 crews, 10 addressed jobs, 3 paid invoices.

**Presets now describe their own booking form** (`bookingFields`, `starterResources`, `addons`, `tagline`):
the new-booking form, booking list/detail, dashboard, customer page, Settings and the nav use the vertical’s own words
("Jobs", "Clients", "Rooms"). A unit test asserts every field is accepted by the preset’s strict booking schema.

**Bugs found and fixed while doing this** (all pre-existing):

1. The staff **new-booking form always sent a venue-only `eventType`**, which salon, dental and consultancy reject
   (strict schemas), so staff could not create bookings in the UI for those verticals. Now data-driven per preset.
2. A business with **no review link inherited the demo garden’s Google link** (`g.page/r/palda-gardens/review`). The fallback is
   now empty; messages drop the link cleanly (`stripReviewLink`), and Settings has a Review link field.
3. Settings’ add-resource/add-service forms **defaulted to kind "space"** (not valid for cleaning); they now offer the
   preset’s kinds. The location field no longer pre-fills "Karen, Nairobi".
4. Seeding a zero-deposit vertical silently **skipped its paid demo bookings** ("Nothing left to invoice"); the seed now
   bills the full amount and prints skip reasons. Demo conversations/complaints/reviews are per vertical instead of
   gazebo copy everywhere.

**Still open (not changed):** `requestReview` sends the `thank_you_review` template, which **salon, dental and
consultancy presets do not define**, and those presets have **no review reminder rule**, so review collection only
runs end to end for venue and cleaning. **WhatsApp is not wired to onboarded tenants.** The agent service maps an inbound message to a tenant through a
`tenant_integrations` row (`kind = whatsapp`, `meta.phoneNumberId`) and otherwise falls back to `DEFAULT_TENANT_SLUG`.
Onboarding does not create that row, so a new tenant’s WhatsApp number will not reach it until one exists (whether the
Settings integrations panel creates it was not verified). Fix this before onboarding a real business.

### 7c. Known UI gaps

- **Delivery ticks are cosmetic.** Outbound inbox messages always show blue double ticks; `messages` has no
  delivery/read status. Real sent/delivered/read needs a status field populated from WhatsApp status webhooks.
- **No global search** (⌘K) and **no count badges** on nav items (e.g. pending approvals); palda-homes has both.
  See `DESIGN-SYSTEM.md` §10.
- **Owner-only screens are still visible to staff** (see §5).

---

## 8. Uncommitted working tree

Last commit: `097b9f7`. Current diff: **42 files, +2,283 / −783** (plus new files).

New files:

```
apps/web/app/(app)/calendar/drag.tsx
apps/web/app/(app)/wambo/chat-list.tsx
apps/web/app/(app)/wambo/thread-client.tsx
apps/web/components/shell.tsx
docs/claude-handoff.md
docs/DESIGN-SYSTEM.md
```

Deleted: `apps/web/components/nav.tsx` (superseded by `shell.tsx`).

Modified groups:

- **Engine**: `agent-engine/src/{agents,eval,guard,run,scenarios,types}.ts`
- **Agent service**: `apps/agent-service/src/{app,run-service}.ts`
- **Web**: approvals, bookings (list/new/detail), calendar, customers, dashboard, expenses, invoices, layout,
  reviews, settings, Wambo inbox/settings, globals.css, login, intake, `packages/services/src/customers.ts`
- **Services/MCP**: `approval-executor.ts`, `approvals.ts`, `context.ts`, `tools.ts`
- **Tests**: `tests/unit/{guard,mcp-stub}.test.ts`, `tests/integration/whatsapp-flow.test.ts`

Before committing: run `pnpm verify` and the integration suite; keep `.env` untracked.

---

## 9. What is pending

### Blocked on the owner / external providers

1. **Tuma sandbox (Phase 2)** — `TUMA_EMAIL`, `TUMA_API_KEY`, public HTTPS callback (`TUMA_CALLBACK_URL` or
   `MPESA_CALLBACK_URL`), test phone. Then:
   `pnpm env:check` → `pnpm smoke:mpesa --phone <number> --amount 1` → callback replay check.
2. **WhatsApp Cloud (real Phase 3)** — `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`,
   `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, a test number, and `WHATSAPP_MODE=cloud`.
3. **OpenRouter (Phases 4/5/7/8/9)** — `OPENROUTER_API_KEY` and a real `WAMBO_MODEL`; then `pnpm eval` and a
   live WhatsApp/staff turn.
4. **Langfuse** (optional) — `LANGFUSE_HOST`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`.
5. ~~**Docker image rebuild**~~ — **done 2026-11-15** (see §7a). It must be repeated after any further code change;
   the integration suite has still not been run inside the new image.
6. **GitHub Actions** — the workflow exists but has never run because of the account issue; local `pnpm verify`
   is the gate.

### Pending on the build side

1. Re-run `pnpm verify` **and** `pnpm test:integration` on the current tree, then commit/push the batch.
2. Update `docs/STATUS.md` (test counts, shadow mode, date/link/tool guards, UI refresh) and
   `docs/tool-contract.md` (53 tools incl. `reviews.list`).
3. Real-provider acceptance and the 2-week shadow pilot.
4. For dental: DPA/consent sign-off before a real clinic.
5. Optionally: hide owner-only UI for staff (currently server-enforced only) — not a security hole, but confusing.
6. Add a delivery-status field to `messages` so the inbox ticks reflect reality (§7b), and optionally global
   search and nav count badges.
7. Refresh stale numbers in `README.md` ("40 unit tests", "18 scenarios" — now 59 and 40) and the Docker lines in
   `docs/STATUS.md`.

---

## 10. How to run and verify

Prerequisites: Node 20+, pnpm 10, PostgreSQL 16 (Docker Compose is provided), optionally Docker.

```bash
pnpm install
cp .env.example .env        # fill AUTH_SECRET, ENCRYPTION_KEY, INTERNAL_SECRET, MCP_TOKEN_SECRET
docker compose up -d        # Postgres 16 on localhost:5432
pnpm db:migrate
pnpm db:seed                # Palda Gardens demo tenant (venue)
```

Three terminals:

```bash
pnpm dev          # web         → http://localhost:3000
pnpm dev:engine   # agent svc   → http://localhost:3100
pnpm dev:worker   # pg-boss jobs
```

Demo logins:

| Role | Email | Password |
|---|---|---|
| Owner | `owner@palda.co.ke` | `owner1234` |
| Staff | `staff@palda.co.ke` | `staff1234` |

Tenant slug: `palda`.

Other verticals (fresh tenant; use `--reset` only in dev):

```bash
pnpm db:seed -- --slug=smile --vertical=dental --name="Smile Dental" --owner=owner@smile.co.ke
pnpm db:seed -- --slug=glow --vertical=salon --name="Glow Salon" --owner=owner@glow.co.ke
pnpm db:seed -- --slug=axis --vertical=consultancy --name="Axis Advisory" --owner=owner@axis.co.ke
```

Verification:

```bash
pnpm verify            # typecheck → test typecheck → unit → mock evals → build
pnpm env:check         # show modes and missing keys without printing secrets
pnpm smoke:mpesa --mock
pnpm test:integration  # needs Postgres
```

The integration suite used an embedded PostgreSQL 16 at
`postgres://postgres:postgres@127.0.0.1:55432/garden_bookings`; the checked-in `.env` points at port `5432`,
so start Docker Postgres or adjust `DATABASE_URL`. A typical local integration run:

```powershell
$env:DATABASE_URL='postgres://postgres:postgres@127.0.0.1:55432/garden_bookings'
$env:AUTH_SECRET='ci-only-secret-0000000000000000000000000000'
$env:ENCRYPTION_KEY=('0'*64)
$env:INTERNAL_SECRET='ci-internal-secret'
$env:MCP_TOKEN_SECRET='ci-mcp-secret'
$env:MPESA_MODE='mock'; $env:WHATSAPP_MODE='mock'; $env:WAMBO_MODEL='mock'
pnpm test:integration
```

---

## 11. Risks and caveats

- **Only mock-verified beyond Phase 1.** Treat real WhatsApp/M-Pesa/model behaviour as unproven.
- **Docker image drift.** The image was current as of the 2026-11-15 rebuild; any later code change needs
  `docker compose up -d --build` before a containerised demo (the source is not mounted).
- **CI has never run.** The first GitHub PR will be the first real CI execution.
- **RLS in development.** Dev connects as a superuser, which bypasses RLS; production needs the dedicated
  non-superuser role documented in `docs/runbook.md`.
- **M-Pesa callbacks** are not signature-verified; safety relies on unguessable checkout ids plus HTTPS.
  Tuma sandbox caps payments at KES 1–100 and can ban a number after three cancelled STK prompts.
- **Tuma success rule:** `result_code === 0 && status === "completed"`; callbacks may arrive flat, wrapped in
  `data`, or in Daraja shape — `parseStkCallback` auto-detects.
- **Staff UI permissions:** owner-only settings are enforced in services, not hidden in the UI.
- **Onboarding is CLI-only.** No self-serve signup (explicitly deferred).
- **Dental** needs a Kenyan DPA/consent sign-off; v1 has no clinical records, prescriptions or insurance claims.
- **No field-service vertical.** Do not promise plumbers/cleaners/home visits without building one.
- **Integration tests share one database** and run serially by configuration; don't parallelise files.
- **Never commit `.env`.** It is gitignored; `pnpm env:check` is the safe way to inspect configuration.

---

## 12. Suggested next moves

1. Run `pnpm verify` and `pnpm test:integration` on the current tree; fix anything that regressed.
2. Update `docs/STATUS.md` and `docs/tool-contract.md`; commit and push the 42-file batch.
3. When keys arrive: `pnpm env:check` → `pnpm smoke:mpesa` → real WhatsApp test → real-model `pnpm eval`.
4. Start the 2-week garden shadow pilot; measure draft approval rate, handoffs and guard flags before promoting
   Wambo to autonomous replies or ops to limited act.
5. Only then onboard salon/dental/consultancy pilots; for dental, get the DPA sign-off first.

---

## 13. Key files for the next agent

| Concern | File |
|---|---|
| Spec / phases | `PLAN.md` |
| Gate evidence | `docs/STATUS.md` |
| Cold start / repo map | `docs/HANDOFF.md` |
| Owner-provided keys / decisions | `docs/ACTION-ITEMS.md` |
| Build chronology / current batch | this file |
| MCP tool contract | `docs/tool-contract.md`, `packages/mcp-server/src/tools.ts` |
| Schema + RLS | `packages/db/src/schema.ts`, `packages/db/migrations/` |
| Domain logic | `packages/services/src/*` |
| Agent engine | `agent-engine/src/{run,guard,agents,scenarios}.ts` |
| WhatsApp/agent routes | `apps/agent-service/src/app.ts`, `run-service.ts` |
| Worker jobs | `apps/worker/src/index.ts` |
| Verticals | `packages/verticals/src/{venue,salon,dental,consultancy}.ts` |
| Integrations | `packages/integrations/src/{whatsapp,mpesa,meetings,crypto}.ts` |
| Web UI | `apps/web/app/(app)/**`, `apps/web/components/{shell,ui}.tsx` |
| Design system / style guide | `docs/DESIGN-SYSTEM.md`, `apps/web/app/globals.css` |
| Tests | `tests/unit/**`, `tests/integration/**` |
