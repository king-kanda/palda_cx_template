#!/usr/bin/env bash
# Build the Palda CX image on this machine and push it to Docker Hub. One image runs every process (web, agent, worker,
# migrate); the server's docker-compose.yml picks the process per service.
# Run from the repo root in Git Bash / WSL / macOS / Linux:
#   docker login -u <dockerhub-user>
#   DOCKERHUB_USER=<dockerhub-user> bash scripts/build-push.sh          # tags: latest + git short SHA
#   DOCKERHUB_USER=<dockerhub-user> bash scripts/build-push.sh v1       # tags: v1 + git short SHA
# Built for linux/amd64 (t3.* and similar). For a Graviton (t4g.*) instance: PLATFORM=linux/arm64.
set -euo pipefail
cd "$(dirname "$0")/.."

: "${DOCKERHUB_USER:?Set DOCKERHUB_USER to your Docker Hub username}"
TAG="${1:-latest}"
SHA="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
PLATFORM="${PLATFORM:-linux/amd64}"
IMAGE="${DOCKERHUB_USER}/palda-cx"

if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  echo "Note: you have uncommitted changes. They ARE included in this image; the ${SHA} tag won't reproduce them."
fi

echo "==> ${IMAGE}:${TAG} and :${SHA} (${PLATFORM})"
docker buildx build \
  --platform "${PLATFORM}" \
  -t "${IMAGE}:${TAG}" -t "${IMAGE}:${SHA}" \
  --push .

echo
echo "Pushed ${IMAGE}:${TAG} and ${IMAGE}:${SHA}."
echo "On the server:  cd ~/palda-cx && bash deploy.sh          (roll back: bash deploy.sh <older-sha>)"
