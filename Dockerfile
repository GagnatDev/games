# Two-stage build: one image serves the built SPA and the API (the homectl
# single-container topology). Pattern: homectl-reference/templates/Dockerfile.
#
# There is no `--secret id=github_token` here: `games` integrates homectl-auth
# through the forward-auth sidecar, so it has no private @gagnatdev/* dependency.
# Add the secret mount back (and a matching .npmrc) if that ever changes.

# -----------------------------------------------------------------------------
# Stage 1: build shared + backend + frontend
# -----------------------------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

RUN corepack enable

# Manifests first, so a source-only change reuses the install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY e2e/package.json e2e/
RUN pnpm install --frozen-lockfile

COPY . .

# shared before backend/frontend: both typecheck against its emitted .d.ts.
RUN pnpm --filter @games/shared run build \
 && pnpm --filter @games/backend run build \
 && pnpm --filter @games/frontend run build

# -----------------------------------------------------------------------------
# Stage 2: runtime — no node_modules, the server is a single bundle
# -----------------------------------------------------------------------------
FROM node:24-alpine
WORKDIR /app

RUN adduser -D -g "" appuser
USER appuser

# Bundled server (.cjs) + the SQL migrations it runs at boot + the built SPA.
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/frontend/dist ./web

EXPOSE 8080
ENV NODE_ENV=production \
    PORT=8080 \
    WEB_ROOT=/app/web \
    MIGRATIONS_DIR=/app/dist/migrations
# AUTH_MODE is set to `sidecar` by the Deployment; the config default in
# production is `sidecar` too, so a missing value cannot disable auth.
ENTRYPOINT ["node", "dist/server.cjs"]
