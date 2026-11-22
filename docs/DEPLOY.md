# Deploying Palda CX to EC2

Same approach as Palda Homes: build the image on your machine, push it to Docker Hub, copy the deploy files to the server over
SSH, and the server pulls and runs. No GitHub Actions.

| Where | File | What it does |
| --- | --- | --- |
| Your machine | `scripts/build-push.sh` | Builds the one image (web, agent, worker, migrate) and pushes `niloticking/palda-cx:latest` + `:<git sha>` |
| Your machine | `scripts/ship-deploy.sh` | `scp`s the `deploy/` files to `~/palda-cx` on the server; `--deploy` also runs `deploy.sh` there |
| Server | `deploy/server-setup.sh` | Fresh Ubuntu only: Docker, nginx, certbot, firewall |
| Server | `deploy/bootstrap.sh` | First time: Docker Hub login, `.env` with generated secrets, first deploy, your Engine login, nginx site |
| Server | `deploy/deploy.sh` | Every release: pull, migrate, restart, wait for healthy. `deploy.sh <sha>` rolls back |
| Server | `deploy/docker-compose.yml` | Postgres, Qdrant, migrate, web (127.0.0.1:3200), agent, worker |

## First deploy

```bash
# on your machine (Git Bash), from the repo root
DOCKERHUB_USER=niloticking bash scripts/build-push.sh
SERVER=ubuntu@<ec2-ip> SSH_KEY="$HOME/.ssh/<key>.pem" bash scripts/ship-deploy.sh

# on the server
bash ~/palda-cx/server-setup.sh      # only on a fresh box; then log out and back in
bash ~/palda-cx/bootstrap.sh         # asks for the domain, writes .env, deploys, creates your Engine login, sets up nginx
nano ~/palda-cx/.env                 # add Meta / Google / Zoho / OpenRouter (or do it in Engine > Settings)
bash ~/palda-cx/deploy.sh            # after editing .env
```

## Every release

```bash
DOCKERHUB_USER=niloticking bash scripts/build-push.sh
SERVER=ubuntu@<ec2-ip> SSH_KEY="$HOME/.ssh/<key>.pem" bash scripts/ship-deploy.sh --deploy
```

## The .env

`deploy/.env.example` is the full list, grouped. bootstrap.sh generates every secret; you supply:

| Key | Where it comes from | Required |
| --- | --- | --- |
| `APP_URL` | `https://<your domain>` (bootstrap fills it) | yes |
| `WHATSAPP_MODE=cloud` | switch from `mock` once the four Meta values are in | for live WhatsApp |
| `META_APP_ID`, `META_APP_SECRET` | Meta app > Settings > Basic | for live WhatsApp |
| `META_ES_CONFIG_ID` | Facebook Login for Business > Configurations | for live WhatsApp |
| `WHATSAPP_VERIFY_TOKEN` | generated; paste into Meta's webhook setup | for live WhatsApp |
| `INTEGRATIONS_MODE=live` | switch from `mock` once a Google or Zoho client is in | for real Google/Zoho |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud > Credentials > OAuth client (Web) | for Google Workspace |
| `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET` | api-console.zoho.com > Server-based client | for Zoho Books / CRM |
| `OPENROUTER_API_KEY` + `WAMBO_MODEL` | openrouter.ai; a real model id | for real agent replies |
| `EMBEDDING_MODE=openrouter` | once the OpenRouter key is set (then Reindex in the Engine) | for real knowledge search |
| `MPESA_MODE`, `TUMA_*` | only the platform fallback; businesses add their own keys in their app | optional |

Meta, Google and Zoho values can also be set in **Engine > Settings** instead (saved encrypted; they win over `.env`).
`ENCRYPTION_KEY` must never change once there is data: back it up.

## URLs to paste into the providers

- Meta webhook: `https://<domain>/webhooks/whatsapp`, verify token from `.env`, fields `messages, smb_message_echoes, history, smb_app_state_sync, account_update`
- Google redirect URIs: `https://<domain>/integrations/callback/google_workspace` and `https://<domain>/auth/google/callback` (sign-in)
- Zoho redirect URIs: `https://<domain>/integrations/callback/zoho_books` and `.../zoho_crm`

## Notes

- The app connects to Postgres as the `postgres` superuser, so row-level security is a backstop only in principle; tenant
  isolation is enforced in the service layer. A restricted database role is still on the list (pending.txt B3).
- No demo data is loaded in production. `bash deploy.sh --demo` adds the "palda" demo business if you want it.
- Backups are not set up yet: snapshot the EBS volume, or `docker compose exec db pg_dump -U postgres garden_bookings`.
