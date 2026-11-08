# Runbook

Everything an operator needs to run, test and go live with Garden Booking OS.

## 1. What runs

| Process | Command | Port | Purpose |
| --- | --- | --- | --- |
| Postgres | `docker compose up -d` | 5432 | Source of truth. |
| Web + API + MCP | `pnpm dev` | 3000 | Staff UI, server actions, `/api/mcp`, `/api/mpesa/callback`. |
| Agent service | `pnpm dev:engine` | 3100 | WhatsApp webhook, Wambo turns, digests. |
| Worker | `pnpm dev:worker` | — | pg-boss jobs: reminders, holds, approvals, digest, events. |

Single-tenant per deployment for the web UI (`DEFAULT_TENANT_SLUG`); every table
is still `tenant_id`-scoped, so one deployment can serve several tenants through
MCP and WhatsApp routing.

## 2. First run

```bash
# 1. Environment
cp .env.example .env
# edit AUTH_SECRET, ENCRYPTION_KEY, INTERNAL_SECRET, MCP_TOKEN_SECRET

# 2. Postgres 16
docker compose up -d

# 3. Schema (includes btree_gist, the overlap exclusion constraint and RLS)
pnpm install
pnpm db:migrate

# 4. Demo tenant: Palda Gardens (venue)
pnpm db:seed
# or another vertical:
# pnpm db:seed -- --slug=salon --vertical=salon --name="Studio Sanaa"
# verticals: venue | salon | dental | consultancy
# add --reset to wipe that tenant first

# 5. Processes (three terminals)
pnpm dev            # http://localhost:3000
pnpm dev:engine     # http://localhost:3100
pnpm dev:worker
```

Demo credentials (from `.env.example`):

| Role | Email | Password |
| --- | --- | --- |
| Owner | `owner@palda.co.ke` | `owner1234` |
| Staff | `staff@palda.co.ke` | `staff1234` |

Tenant slug: `palda`.

## 3. Verification

```bash
pnpm typecheck      # every package and app
pnpm test           # unit tests (no database needed)
pnpm eval:mock      # 10 deterministic agent scenarios, no LLM/network
pnpm build          # production build of the web app

# Needs Postgres (docker compose up -d && pnpm db:migrate)
pnpm test:integration
```

`pnpm test:integration` seeds an isolated tenant, prices a quote, creates a
booking at a far-future slot, then asserts a second booking for the same
resource/time fails with `SLOT_UNAVAILABLE`. It is skipped automatically when
`DATABASE_URL` is not set.

What the unit suite covers: money arithmetic (`computeQuote`), Nairobi
time/date conversion, guard rails (money must come from tools, forbidden
promises, PII, repeats), the MCP tool contract (unique names, tiers, principal
visibility, sensitive-write gating), and all four vertical presets.

## 4. Database guarantees

`packages/db/migrations/0000_*` is generated from `packages/db/src/schema.ts`.
`0001_tenancy_and_overlap.sql` adds what Drizzle cannot express:

- `CREATE EXTENSION btree_gist`
- `resource_occupancy_no_overlap` — `EXCLUDE USING gist (tenant_id WITH =,
  resource_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&) WHERE
  (status = 'active')`. Any concurrent double booking raises `23P01`, which the
  services map to `SLOT_UNAVAILABLE`.
- RLS enabled **and forced** on all 32 tables, with `tenant_isolation` policies
  keyed on `current_setting('app.tenant_id', true)`. `withTenant()` sets it per
  transaction.

After editing the schema:

```bash
pnpm db:generate    # writes packages/db/migrations/000N_*.sql
pnpm db:migrate
```

### RLS roles (production hardening)

Superusers and roles with `BYPASSRLS` ignore RLS. In development the app
connects as `postgres`, so RLS is a correctness backstop rather than an
enforced boundary. To enforce it:

```sql
CREATE ROLE garden_web LOGIN PASSWORD '<strong>';
GRANT CONNECT ON DATABASE garden_bookings TO garden_web;
GRANT USAGE ON SCHEMA public TO garden_web;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO garden_web;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO garden_web;
```

Point the web app at `garden_web` (`DATABASE_URL`). Tenant resolution paths are
RLS-safe: `tenants` allows `SELECT` (public slug/branding metadata), login and
MCP auth then run inside `withTenant`. The **worker and agent service** still
need a privileged role for the owner: they enumerate tenants and route inbound
WhatsApp webhooks by `phone_number_id` before a tenant context exists.

## 5. MCP and the agent engine

The engine imports nothing from `@garden/services`; it talks to the app only via
the `ToolGateway` seam, which in production is `HttpMcpGateway` speaking the MCP
wire contract. The tool contract, tiers and approval rules are documented in
[`tool-contract.md`](./tool-contract.md).

```bash
# owner token
TOKEN=$(pnpm --filter @garden/mcp-server issue-token -- --tenant palda --type staff --email owner@palda.co.ke)

curl -s http://localhost:3000/api/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

`pnpm eval:mock` exercises the deterministic `MockAdapter`; set
`OPENROUTER_API_KEY` (and optionally `WAMBO_MODEL`) to run `pnpm eval` against a
real model.

Agent definitions live in `agent-engine/src/agents.ts` (`wambo`, `admin`,
`ledger-digest`, ops). Wambo's persona is generic; tenant facts/policies come
from `knowledge.get_business_info`, so the same engine serves every tenant and
vertical.

## 6. WhatsApp (Meta Cloud API)

1. Create a Meta app with WhatsApp; note the phone number id and WABA id.
2. Set `WHATSAPP_MODE=cloud`, `WHATSAPP_PHONE_NUMBER_ID`,
   `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`.
3. In Meta, set the callback URL to
   `https://<host>/webhooks/whatsapp` and the verify token to
   `WHATSAPP_VERIFY_TOKEN`.
4. Store the same phone number id on
   `tenant_integrations(kind='whatsapp', meta.phoneNumberId)` so inbound
   messages route to the right tenant.
5. `GET /webhooks/whatsapp` answers the verification challenge; `POST` verifies
   `X-Hub-Signature-256` when `WHATSAPP_APP_SECRET` is set.

`WHATSAPP_MODE=mock` logs sends to `integrations_log` and still writes the
outbound bubble, so the whole flow is testable offline.

Staff are **not** on WhatsApp in v1: the staff channel is the web inbox
(`/wambo`). Staff replies and Wambo replies both go to the customer on
WhatsApp/web.

## 7. M-Pesa (Daraja)

1. Set `MPESA_MODE=daraja`, `MPESA_ENV`, consumer key/secret, shortcode and
   passkey.
2. Set the callback URL to a public HTTPS endpoint:
   `https://<host>/api/mpesa/callback?tenant=palda`.
3. Register the C2B validation/confirmation URL with the same endpoint.

The callback is idempotent on `mpesa_receipt`; unmatched C2B payments appear in
Invoices → Unmatched and can be matched from the UI or `payments.match_unmatched`.
`MPESA_MODE=mock` produces a pending payment that can be completed with
“Simulate success” on the invoice page.

## 8. Worker jobs

| Queue | Schedule (Africa/Nairobi) | Work |
| --- | --- | --- |
| `reminders.dispatch` | every minute | Send due reminders, cancel stale ones. |
| `holds.release` | every 5 minutes | Expire unpaid holds. |
| `approvals.expire` | hourly | Expire approvals older than 24h. |
| `digest.daily` | 07:00 | Owner digest. |
| `events.emit` | on demand | Forward app events to the agent service. |

The worker keeps a pg-boss schema (`PGBOSS_SCHEMA`, default `pgboss`); it is
created automatically on first start.

## 9. Go-live checklist

- [ ] `AUTH_SECRET`, `ENCRYPTION_KEY`, `INTERNAL_SECRET`, `MCP_TOKEN_SECRET`
      replaced with unique 32+ byte secrets.
- [ ] `ENCRYPTION_KEY` backed up: rotating it loses decryptable integration
      secrets and sensitive customer fields.
- [ ] `pnpm db:migrate` run; `resource_occupancy_no_overlap` exists
      (`\d resource_occupancy`).
- [ ] Non-default owner password; demo staff account disabled or renamed.
- [ ] `APP_URL` and `AGENT_SERVICE_URL` are public HTTPS URLs.
- [ ] WhatsApp webhook verified; a real inbound message reaches `/wambo`.
- [ ] M-Pesa sandbox STK round-trip succeeds; C2B confirmation matches a payment.
- [ ] `pnpm test`, `pnpm eval:mock`, `pnpm build` green in CI.
- [ ] Backup/restore tested (pg_dump + restore into a scratch database).
- [ ] Alerting on worker exit, agent-service 5xx, and failed `integrations_log`
      rows.

## 10. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| `DATABASE_URL is not set` | Copy `.env.example` to `.env`; the web/worker read it from the repo root. |
| `extension "btree_gist" is not available` | Use the `postgres:16` image from `docker-compose.yml`, or install `postgresql-contrib`. |
| `resource_occupancy_no_overlap` already exists | A previous partial migration; drop the constraint and re-run `pnpm db:migrate`. |
| Login says “No workspace found” | Run `pnpm db:seed`; check `DEFAULT_TENANT_SLUG`. |
| Agent replies with the fallback sentence | The guard rejected the draft (ungrounded amount, forbidden promise, PII, repeat, too long). Check `agent_runs.flag_reasons` and `audit_log`. |
| WhatsApp webhook 401 | `WHATSAPP_APP_SECRET` mismatch, or `WHATSAPP_VERIFY_TOKEN` mismatch on the GET challenge. |
| M-Pesa callback 200 but no payment | Receipt unmatched: check Invoices → Unmatched; the callback always ACKs to stop Daraja retries. |
| `pnpm db:generate` asks questions | Schema has an ambiguous change; prefer explicit column renames before generating. |
