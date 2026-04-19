# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS node-base

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

FROM node-base AS workspace-build

WORKDIR /app

COPY package*.json ./
COPY tsconfig*.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/domain/package.json packages/domain/package.json
RUN --mount=type=cache,target=/root/.npm npm ci

COPY apps/api apps/api
COPY apps/web apps/web
COPY packages/domain packages/domain
COPY nginx.conf nginx.conf
RUN npm run prisma:generate --workspace @ses/api
RUN npm run build

FROM workspace-build AS api-build

FROM workspace-build AS runtime-deps

RUN npm prune --omit=dev --workspaces --include-workspace-root

FROM node-base AS api-runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3211
ENV HOST=0.0.0.0

COPY --from=runtime-deps /app/package*.json ./
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=workspace-build /app/apps/api/package.json ./apps/api/package.json
COPY --from=workspace-build /app/apps/api/dist ./apps/api/dist
COPY --from=workspace-build /app/apps/api/prisma ./apps/api/prisma
COPY --from=workspace-build /app/packages/domain/package.json ./packages/domain/package.json
COPY --from=workspace-build /app/packages/domain/dist ./packages/domain/dist

USER node
EXPOSE 3211
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=5 CMD ["node", "-e", "fetch(`http://127.0.0.1:${process.env.PORT || 3211}/api/v1/health`).then((res) => { if (!res.ok) process.exit(1); }).catch(() => process.exit(1));"]
CMD ["node", "apps/api/dist/src/main.js"]

FROM nginxinc/nginx-unprivileged:1.27-alpine AS web-runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=workspace-build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 3210
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=5 CMD wget -qO- http://127.0.0.1:3210/healthz >/dev/null || exit 1
