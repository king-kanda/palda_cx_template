# syntax=docker/dockerfile:1
# One image for every process in the monorepo (web, agent-service, worker,
# migrate/seed). Compose picks the process via `command`.
FROM node:24-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1 \
    CI=true \
    TZ=Africa/Nairobi

RUN npm install -g pnpm@10.34.9 \
    && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

# Production build of the Next.js app. Does not need a database.
RUN pnpm build

ENV NODE_ENV=production
EXPOSE 3000 3100
CMD ["pnpm", "--filter", "@garden/web", "start"]
