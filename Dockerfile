# Developer-friendly build. Not hardened for production.
# Builds the full workspace: domain package + NestJS API + React SPA.
#
# Usage (local test of the full stack):
#   docker build --target api-dev -t ses-api .
#   docker build --target web-dev -t ses-web .
#
# For day-to-day development, just use: ./dev.sh up
# Docker is only needed here if you want to smoke-test the compiled output.

FROM node:22-bookworm-slim AS base

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# ── Dependency install (shared layer) ─────────────────────────────────────────

FROM base AS deps

WORKDIR /app

COPY package*.json ./
COPY tsconfig*.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/domain/package.json packages/domain/

RUN npm ci

# ── Build all workspaces ──────────────────────────────────────────────────────

FROM deps AS build

COPY apps/api apps/api
COPY apps/web apps/web
COPY packages/domain packages/domain

RUN npm run prisma:generate --workspace @ses/api
RUN npm run build

# ── API target ────────────────────────────────────────────────────────────────

FROM base AS api-dev

WORKDIR /app
ENV NODE_ENV=development
ENV PORT=3211

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api ./apps/api
COPY --from=build /app/packages/domain ./packages/domain

EXPOSE 3211
CMD ["node", "apps/api/dist/src/main.js"]

# ── Web target (static files served by node http-server for local testing) ───

FROM base AS web-dev

RUN npm install -g http-server

WORKDIR /app
COPY --from=build /app/apps/web/dist /app/dist

EXPOSE 3210
CMD ["http-server", "/app/dist", "-p", "3210", "--cors"]
