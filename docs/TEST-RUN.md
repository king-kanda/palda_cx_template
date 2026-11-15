# Real-provider test run

Put keys in `.env` only (never commit it). Docker reads `.env` through `env_file`, so after editing run `docker compose up -d` (add `--build` only if code changed).

## 1. Keys and modes

| Provider | Set in `.env` | Notes |
| --- | --- | --- |
| OpenRouter | `OPENROUTER_API_KEY`, `WAMBO_MODEL=<real model id>` (e.g. `openai/gpt-4.1-mini`) | `WAMBO_MODEL=mock` forces the scripted mock; change it or the key is ignored |
| WhatsApp Cloud | `WHATSAPP_MODE=cloud`, `META_APP_ID`, `META_APP_SECRET`, `META_ES_CONFIG_ID`, `WHATSAPP_VERIFY_TOKEN` | App values only. Each customer connects their own number via Embedded Signup. See `docs/WHATSAPP-ONBOARDING.md`. |
| Tuma (M-Pesa) | `MPESA_MODE=tuma`, `TUMA_EMAIL`, `TUMA_API_KEY`, `TUMA_CALLBACK_URL` | Sandbox caps payments at KES 1-100 |
| Langfuse | `LANGFUSE_HOST`, `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | Optional; enables trace links in the Engine |

## 2. Public HTTPS address

Meta and Tuma cannot reach `localhost`. Use a tunnel (Cloudflare Tunnel or ngrok):

- Web `:3000` -> `APP_URL=https://<host>`, `TUMA_CALLBACK_URL=https://<host>/api/mpesa/callback?tenant=palda`
- Agent service `:3100` -> Meta webhook `https://<host-for-3100>/webhooks/whatsapp`, verify token = `WHATSAPP_VERIFY_TOKEN`

## 3. WhatsApp routing

Each customer's owner connects their own number from Integrations in their own app (the Engine shows it read-only). The number is recorded in `whatsapp_routes` and inbound messages are routed by it; a message to a number nobody connected is ignored. See `docs/WHATSAPP-ONBOARDING.md`.

## 4. Order of checks

```bash
pnpm env:check                          # modes + missing keys
pnpm eval                               # real-model evals (needs OPENROUTER_API_KEY + a real WAMBO_MODEL)
pnpm smoke:mpesa --phone <yours> --amount 1
docker compose up -d                    # pick up the new .env
```

Then verify the webhook in Meta (it calls `GET /webhooks/whatsapp`), send a real WhatsApp message to the number, and watch it:

- the reply in the customer app inbox (`/inbox`)
- the run in the Engine: `/engine/<customer>/runs` (outcome, cost, latency, trace link when Langfuse is on)

## 4a. Real-model evals and embeddings

`pnpm eval` runs the scenarios against the real model (it needs `OPENROUTER_API_KEY` and a real `WAMBO_MODEL`, or `--model=<id>`); a safety failure fails the run, wording differences are warnings. Use `pnpm eval -- --runs=3` to see run-to-run variation. `pnpm eval:mock` is the free offline replay.

For real semantic search set `EMBEDDING_MODE=openrouter` (and optionally `EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`). If you change the model or size, press **Reindex** on each customer's Knowledge page. `pnpm env:check` shows the vector and embedding modes and whether Qdrant is reachable.

## 5. Safety for the first real messages

Turn on **shadow mode** for the business first, so the agent drafts and staff approve instead of sending. Switch it off once drafts look right.

## 6. State of the database

Synthetic demo runs have been cleared. Engine charts will be empty until real runs arrive.
