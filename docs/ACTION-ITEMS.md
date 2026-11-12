# Action items for the owner

> Last updated: 2026-11-12. Everything below is **yours** to provide; the code is
> being finished in parallel. Tests run last, once these are in place.
> Put secrets in `.env` only — never commit that file or paste keys into chat.

## 1. Provider keys

| Done | Key | Where to get it | Notes |
| --- | --- | --- | --- |
| ☐ | `TUMA_EMAIL` | Tuma Merchant Portal → Developer API → Keys & Docs | Merchant account email |
| ☐ | `TUMA_API_KEY` | same page | Sandbox caps payments at KES 1–100 until the account is approved for live |
| ☐ | `OPENROUTER_API_KEY` | https://openrouter.ai/keys | Unlocks real-model evals for Wambo, Admin and the digest |
| ☐ | `WHATSAPP_PHONE_NUMBER_ID` | Meta app → WhatsApp → API Setup | |
| ☐ | `WHATSAPP_BUSINESS_ACCOUNT_ID` | Meta app → WhatsApp → API Setup | Needed for templates/analytics |
| ☐ | `WHATSAPP_ACCESS_TOKEN` | Meta app → WhatsApp → API Setup | Use a permanent system-user token, not the 24h test token |
| ☐ | `WHATSAPP_APP_SECRET` | Meta app → Settings → Basic | Verifies webhook signatures |
| ☐ | `WHATSAPP_VERIFY_TOKEN` | You choose it | Must match the value entered in Meta's webhook setup |
| ☐ | `LANGFUSE_HOST` / `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | https://cloud.langfuse.com | Optional; enables agent tracing |
| ☐ | Google Calendar OAuth | Google Cloud console | **Not needed for v1** — meetings ship as a working Jitsi link; only source this if we later add a Calendar provider |

**Also decide:** the WhatsApp Business number must be a real number that can
receive the verification code. If it is already on WhatsApp, it has to be
migrated to the Cloud API number (or use a fresh number).

## 2. Public HTTPS address

You need one public hostname that reaches this machine. Options: a real domain
with TLS, a Cloudflare Tunnel, or ngrok for sandbox-only testing.

| Done | Item | Value to set |
| --- | --- | --- |
| ☐ | Public base URL for the web app (`:3000`) | `APP_URL=https://<host>` |
| ☐ | Public M-Pesa callback | `TUMA_CALLBACK_URL=https://<host>/api/mpesa/callback?tenant=palda` |
| ☐ | Public WhatsApp webhook (`:3100`) | Point Meta at `https://<host>/webhooks/whatsapp` (or proxy `/webhooks/*` to the agent service) |
| ☐ | The host must be reachable from the internet | Tuma and Meta cannot call `localhost` |

## 3. Product answers (PLAN §11 — needed before the pilot)

1. ☐ Space list, and does "Whole Garden" block every other space?
2. ☐ Packages and prices, deposit %, cancellation/reschedule policy, VAT-registered?
3. ☐ Operating hours, music cut-off, setup/teardown buffer.
4. ☐ Payment channels: Till, Paybill, or STK only? Bank transfers?
5. ☐ Who receives handoff alerts, and when are humans reachable?
6. ☐ Is the WhatsApp Business number already verified with Meta? Is there an existing customer list to import?
7. ☐ Public review destination (Google Maps link).

## 4. Pilot logistics

| Done | Item |
| --- | --- |
| ☐ | Real garden confirmed for the 2-week shadow-mode pilot |
| ☐ | Owner + staff accounts created (or demo credentials replaced) |
| ☐ | Staff briefed: Wambo drafts, staff approve, no autonomous sends during shadow mode |
| ☐ | A test Safaricom number you control, for the STK prompt |

## 5. Tooling / accounts

| Done | Item | Why |
| --- | --- | --- |
| ☐ | Resolve the GitHub account/billing issue | CI cannot run until Actions is enabled |
| ☐ | Docker available (local or a VPS) | Rebuild the image so it picks up Tuma + the Phase 3 fixes |
| ☐ | A place to run this in production (VPS or PaaS with Postgres 16) | Pilot hosting |

## 6. When these are done

Tell me, and I will run the gates in this order — no values need to be shared
with me:

```bash
pnpm env:check                                   # what is still missing
pnpm smoke:mpesa --phone <your number> --amount 1 # Phase 2, real Tuma sandbox
pnpm test:integration                            # 40 Postgres tests
pnpm eval                                        # real-model agent evals
docker compose up --build                        # full stack + image rebuild
docker compose run --rm migrate pnpm test:integration
```

Then we update `docs/STATUS.md`, close the phase gates, and start shadow mode.
