#!/usr/bin/env bash
# Copy the deploy files from this machine straight to the EC2 instance (no GitHub Actions). Safe to repeat: it never touches the
# server's .env or data, only docker-compose.yml, the scripts, the nginx template and .env.example.
#   SERVER=ubuntu@<ec2-ip> SSH_KEY="$HOME/.ssh/<key>.pem" bash scripts/ship-deploy.sh
#   ... bash scripts/ship-deploy.sh --deploy      # also run deploy.sh on the server afterwards
set -euo pipefail
cd "$(dirname "$0")/.."

: "${SERVER:?Set SERVER, e.g. SERVER=ubuntu@13.62.94.43}"
: "${SSH_KEY:?Set SSH_KEY to the .pem file for the instance}"
DIR="${REMOTE_DIR:-palda-cx}"
SSH=(ssh -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new "$SERVER")
SCP=(scp -i "$SSH_KEY" -o StrictHostKeyChecking=accept-new)

FILES=(deploy/docker-compose.yml deploy/deploy.sh deploy/bootstrap.sh deploy/server-setup.sh deploy/nginx-palda-cx.conf deploy/.env.example)
for f in "${FILES[@]}"; do [ -f "$f" ] || { echo "Missing $f"; exit 1; }; done

echo "==> ${SERVER}:~/${DIR}"
"${SSH[@]}" "mkdir -p ~/${DIR}"
"${SCP[@]}" "${FILES[@]}" "${SERVER}:~/${DIR}/"
"${SSH[@]}" "chmod +x ~/${DIR}/*.sh && sed -i 's/\r$//' ~/${DIR}/*.sh ~/${DIR}/docker-compose.yml ~/${DIR}/.env.example"
echo "Copied: ${FILES[*]##*/}"

if [ "${1:-}" = "--deploy" ]; then
  echo "==> Running deploy.sh on the server"
  "${SSH[@]}" "cd ~/${DIR} && bash deploy.sh"
else
  echo
  echo "First time on this server:  ssh in, then  bash ~/${DIR}/server-setup.sh  (if Docker/nginx aren't installed yet),"
  echo "                            log out and in, then  bash ~/${DIR}/bootstrap.sh"
  echo "After that, every release:  bash scripts/build-push.sh && bash scripts/ship-deploy.sh --deploy"
fi
