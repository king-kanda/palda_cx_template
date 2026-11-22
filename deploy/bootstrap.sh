#!/usr/bin/env bash
# First-time setup of Palda CX on the server (after server-setup.sh, or on a box that already has Docker and nginx).
# Does: Docker Hub login, .env with generated secrets, first deploy, your Engine login, and the nginx site for your domain.
# Safe to re-run: an existing .env is kept, and the Engine login is only created when you ask.
#   bash ~/palda-cx/bootstrap.sh
set -euo pipefail
cd "$(dirname "$0")"

[ -f docker-compose.yml ] && [ -f deploy.sh ] && [ -f .env.example ] || { echo "Run scripts/ship-deploy.sh from your machine first."; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker isn't usable by this user. Run server-setup.sh, then log out and back in."; exit 1; }

read -rp "Docker Hub username [niloticking]: " HUB; HUB="${HUB:-niloticking}"
read -rp "Domain for Palda CX [jawabu.palda.co.ke]: " DOMAIN; DOMAIN="${DOMAIN:-jawabu.palda.co.ke}"
read -rp "Local port for the web app [3200]: " PORT; PORT="${PORT:-3200}"
if ss -ltn 2>/dev/null | awk '{print $4}' | grep -qE "[:.]${PORT}$" && ! docker compose ps -q web >/dev/null 2>&1; then
  echo "Port ${PORT} is already in use on this server (another app?). Re-run and pick another."; exit 1
fi

if ! grep -q '"auths"' ~/.docker/config.json 2>/dev/null; then
  echo "==> Docker Hub login (use an access token as the password; read-only is enough)"
  docker login -u "$HUB"
fi

if [ -f .env ]; then
  echo "==> Keeping the existing .env"
else
  gen() { openssl rand -base64 64 | tr -d '/+=\n' | cut -c1-"$1"; }
  umask 077
  cp .env.example .env
  set_env() { sed -i "s|^$1=.*|$1=$2|" .env; }
  set_env DOCKERHUB_USER "$HUB"
  set_env APP_URL "https://$DOMAIN"
  set_env WEB_PORT "$PORT"
  set_env POSTGRES_PASSWORD "$(gen 32)"
  set_env AUTH_SECRET "$(gen 48)"
  set_env ENCRYPTION_KEY "$(openssl rand -hex 32)"
  set_env INTERNAL_SECRET "$(gen 32)"
  set_env MCP_TOKEN_SECRET "$(gen 32)"
  set_env QDRANT_API_KEY "$(gen 32)"
  set_env WHATSAPP_VERIFY_TOKEN "$(gen 32)"
  set_env TUMA_CALLBACK_URL "https://$DOMAIN/api/mpesa/callback?tenant=palda"
  set_env MPESA_CALLBACK_URL "https://$DOMAIN/api/mpesa/callback?tenant=palda"
  echo "==> Wrote .env with generated secrets. Back up ENCRYPTION_KEY somewhere safe: without it stored tokens can't be read."
  echo "    Add your Meta / Google / Zoho / OpenRouter values now (nano .env), or later in Engine > Settings."
  read -rp "Press Enter to deploy (or Ctrl+C to edit .env first, then re-run this script)... " _
fi

echo "==> Deploying"
bash deploy.sh

read -rp "Create an Engine (Palda team) login now? [Y/n]: " MAKE
if [ "${MAKE:-Y}" != "n" ] && [ "${MAKE:-Y}" != "N" ]; then
  read -rp "  Email: " AEMAIL
  read -rp "  Name: " ANAME
  while :; do
    read -rsp "  Password (12+ chars): " APASS; echo
    [ "${#APASS}" -ge 12 ] && break || echo "  Too short."
  done
  docker compose run --rm migrate pnpm engine:admin --email "$AEMAIL" --name "$ANAME" --password "$APASS"
fi

echo "==> nginx site for $DOMAIN"
CERT=/etc/ssl/cloudflare/palda.pem
KEY=/etc/ssl/cloudflare/palda.key
PROXY="
        proxy_pass http://127.0.0.1:${PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_read_timeout 120s;"
if sudo test -f "$CERT" && sudo test -f "$KEY"; then
  # Same Cloudflare origin certificate as the other Palda apps on this box (it must cover $DOMAIN, e.g. *.palda.co.ke).
  sudo tee /etc/nginx/sites-available/palda-cx >/dev/null <<EOF
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    http2 on;
    server_name $DOMAIN;

    ssl_certificate     $CERT;
    ssl_certificate_key $KEY;

    client_max_body_size 25m;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {$PROXY
        proxy_set_header X-Forwarded-Proto https;
    }
}
EOF
  NEXT="Point $DOMAIN at this server in Cloudflare (proxied), then open https://$DOMAIN/engine/login"
else
  sudo tee /etc/nginx/sites-available/palda-cx >/dev/null <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    client_max_body_size 25m;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {$PROXY
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
  NEXT="Point $DOMAIN's DNS at this server, then run:  sudo certbot --nginx -d $DOMAIN   and open https://$DOMAIN/engine/login"
fi
sudo ln -sf /etc/nginx/sites-available/palda-cx /etc/nginx/sites-enabled/palda-cx
sudo nginx -t && sudo systemctl reload nginx

cat <<MSG

Done.
  $NEXT

Then in Meta (WhatsApp > Configuration > Webhook):
  Callback URL:  https://$DOMAIN/webhooks/whatsapp
  Verify token:  $(grep '^WHATSAPP_VERIFY_TOKEN=' .env | cut -d= -f2-)
Google redirect URIs: https://$DOMAIN/integrations/callback/google_workspace  and  https://$DOMAIN/auth/google/callback
Zoho redirect URIs:   https://$DOMAIN/integrations/callback/zoho_books  and  .../zoho_crm
MSG
