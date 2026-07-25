# Architecture

## Request flow

```
Browser ──HTTPS──▶ Scaleway LB ──▶ nginx Ingress ──▶ Service:80 ──┐
                                                                  │
   ┌─ pod ─────────────────────────────────────────────────────────▼──┐
   │  auth-proxy :4180  ──(X-Homectl-*)──▶  games :8080               │
   └──────────────────────────────────────────┬───────────────────────┘
                                              ▼
                              shared Postgres (private VPC), db `games`
```

The app container is never an ingress backend and never a Service target. The
sidecar strips every inbound `X-Homectl-*` and `Authorization` header before
injecting its own, which is the only reason the backend can trust them.

Inside the pod:

- `/health` — unauthenticated; the kubelet probes the app container directly, so
  it never passes through the sidecar.
- `/api/*` — authenticated. `authMiddleware` reads the identity, `resolveUser`
  maps the auth `sub` to a `users` row (creating it on first sight), and every
  query is scoped by that row's id.
- `/auth/relogin` — the app's single re-login entry point. See [pwa.md](pwa.md).
- `/static/*` — the built SPA's assets, proxied by the sidecar **without** a
  session (`BYPASS_STATIC_AUTH`).
- everything else — `index.html`, auth-gated, so a deep link is a real top-level
  navigation that the sidecar can redirect to login.

## Auth modes

`AUTH_MODE` picks the provider (`backend/src/auth/index.ts`):

| Mode | Identity | Used by |
|------|----------|---------|
| `dev` | a fixed principal, overridable per request with `x-dev-sub` | `pnpm dev`, backend tests, e2e |
| `sidecar` | the `X-Homectl-User` / `-Email` / `-Role` headers | production |

The default is `sidecar` whenever `NODE_ENV=production`, so a missing overlay
cannot silently disable authentication.

The sidecar does not project the global `isAdmin` claim into a header, so
authorization gates on this app's own role (`player` | `admin` in
`homectl-auth`'s `apps.json`).

## Code splitting

The requirement is that opening one game does not pay for the others.

```
index-<hash>.js          the shell: router, hub, profile, API client   ~15 kB
vendor-react-<hash>.js   React + router, cached across every game     ~230 kB
game-landfall-<hash>.js  Landfall, and nothing else                    ~57 kB
```

How it holds together:

1. `shared/src/catalogue.ts` lists games as **metadata only** — no React, no game
   code — so both bundles can import it freely.
2. `frontend/src/games/registry.ts` maps each id to a `lazy(() => import(...))`
   with a literal path. That dynamic import is what creates the chunk.
3. `vite.config.ts` names those dynamic chunks `game-<id>-<hash>.js` via
   `chunkFileNames`. It does **not** use `manualChunks` for games: forcing a game's
   modules into a named chunk turns that chunk into a magnet and the shell ends up
   statically importing it — the exact thing being avoided.
4. `frontend/scripts/check-chunks.mjs` fails the build if a catalogue game has no
   chunk, and an e2e test asserts at runtime that loading `/` fetches no
   `game-*.js` while opening `/landfall` does.

Value imports from `@games/shared` use the `catalogue` subpath rather than the
package root, so the Zod API schemas stay out of the shell chunk.

## Single container

One image serves both halves (`backend/src/app.ts`):

- `WEB_ROOT` points at the built SPA. Assets are served under `/static/` with
  immutable caching for hashed files, `no-store` for `sw.js` (plus
  `Service-Worker-Allowed: /`), and `no-store` for `index.html`.
- Unset locally: Vite serves the frontend and proxies `/api`, `/auth`, `/health`
  to the backend.

The backend ships as a single CommonJS bundle (`dist/server.cjs`) with the SQL
migrations beside it, so the runtime stage of the image carries no `node_modules`.

## Boot order

`backend/src/server.ts`: run migrations → sync the game catalogue into the `games`
table → listen. The startup probe therefore only goes green once the schema the
running code expects is actually in place. Migrations are advisory-locked, so a
rolling deploy where several pods boot at once is safe.
