#!/usr/bin/env bash
# Pull the image from Docker Hub and (re)start Palda CX. Migrations run before the new app starts. Data volumes are never touched.
# Run on the server in ~/palda-cx:
#   bash deploy.sh             # latest image (TAG in .env, default latest)
#   bash deploy.sh 9942a07     # a specific build; use this to roll back to an earlier SHA
#   bash deploy.sh --logs      # deploy, then follow the web and agent logs
#   bash deploy.sh --demo      # also load the "palda" demo business (skips if it already exists). Not for real customers.
set -euo pipefail
cd "$(dirname "$0")"

FOLLOW=0
DEMO=0
for arg in "$@"; do
  case "$arg" in
    --logs) FOLLOW=1 ;;
    --demo) DEMO=1 ;;
    -*) echo "Unknown option: $arg"; exit 1 ;;
    *) export TAG="$arg" ;;
  esac
done

[ -f .env ] || { echo "Missing .env in $(pwd). Run bootstrap.sh first (or cp .env.example .env and fill it in)."; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker isn't usable by this user. Log out and back in after server-setup.sh."; exit 1; }

image_id() { docker inspect -f '{{.Image}}' "$(docker compose ps -q "$1" 2>/dev/null)" 2>/dev/null | cut -c8-19 || true; }
BEFORE=$(image_id web)

APP_SERVICES=(migrate web agent worker)

echo "==> Pulling (tag: ${TAG:-$(grep '^TAG=' .env | cut -d= -f2- || true)})"
# Only the app image is pulled. Postgres and Qdrant are not: a newer database image would make compose restart the database.
docker compose pull "${APP_SERVICES[@]}"

echo "==> Removing the old app containers (databases and their volumes are left alone)"
docker compose stop "${APP_SERVICES[@]}" >/dev/null 2>&1 || true
# -v drops only anonymous volumes of these containers; the named volumes (pgdata, qdrant) belong to db/qdrant and stay.
docker compose rm -f -v "${APP_SERVICES[@]}" >/dev/null 2>&1 || true

echo "==> Starting fresh app containers (migrations first)"
# The app containers no longer exist, so they are created from scratch. --no-recreate guarantees a running db/qdrant is
# kept exactly as it is (a first deploy still creates them).
docker compose up -d --no-recreate --remove-orphans

if [ "$DEMO" = "1" ]; then
  echo "==> Loading the demo business"
  docker compose run --rm migrate pnpm db:seed || echo "(demo business already exists, skipped)"
fi

echo "==> Waiting for web and agent to be healthy"
web=starting; agent=starting
for _ in $(seq 1 40); do
  web=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q web)" 2>/dev/null || echo starting)
  agent=$(docker inspect -f '{{.State.Health.Status}}' "$(docker compose ps -q agent)" 2>/dev/null || echo starting)
  [ "$web" = "healthy" ] && [ "$agent" = "healthy" ] && break
  sleep 3
done

AFTER=$(image_id web)
docker compose ps
echo
if [ "$BEFORE" = "$AFTER" ]; then echo "Image unchanged (${AFTER:-none})."; else echo "Image ${BEFORE:-none} -> ${AFTER}"; fi

if [ "$web" != "healthy" ] || [ "$agent" != "healthy" ]; then
  echo "NOT healthy (web: $web, agent: $agent). Recent logs:"
  docker compose logs --tail 60 migrate web agent
  echo "Roll back with:  bash deploy.sh <previous-sha>"
  exit 1
fi

docker image prune -f >/dev/null
echo "Deployed: $(grep '^APP_URL=' .env | cut -d= -f2-)"
[ "$FOLLOW" = "1" ] && exec docker compose logs -f --tail 50 web agent
exit 0
