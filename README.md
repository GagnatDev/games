# games

`games.homectl.no` — one installable PWA hosting several small games, each at its
own address and in its own bundle:

| Game | Address | State |
|------|---------|-------|
| [2048](frontend/src/games/2048) | `games.homectl.no/2048` | playable |
| [Landfall](frontend/src/games/landfall) | `games.homectl.no/landfall` | shell only |

**2048** is the tile-sliding puzzle, played with the arrow keys or a swipe. The
whole run — board, seed and score — lives in one save document on the server, so a
game started on the laptop continues on the phone, and a finished run posts to a
leaderboard. Rules in [`engine.ts`](frontend/src/games/2048/engine.ts), save shape
in [`state.ts`](frontend/src/games/2048/state.ts).

**Landfall** is a modern take on *Ports of Call* (1986): charter a tramp freighter,
chase cargo across the world's ports, out-trade the tide. Right now it is a shell —
the route, the bundle and the persistence are real, the game is not. That is
deliberate: the deploy is verifiable before any gameplay exists.

## How it fits the platform

A standard [homectl](https://github.com/GagnatDev/homectl-reference) app:

- **Auth** — behind the `homectl-auth-proxy` **sidecar**. The SPA holds no token
  and the backend does no auth work; it reads the verified `X-Homectl-*` headers.
- **Database** — its own database in the shared Postgres 17 instance, `games`.
- **Web Push** — a Terraform-managed VAPID keypair (`games-vapid-secrets`).
- **Runtime** — one image serving the SPA and the API, on Kapsule.

Infrastructure lives in `homectl-infra`
(`games = { postgres = true, auth = true, vapid = true }`); the OAuth client is
registered in `homectl-auth`'s `apps.json`. Nothing here creates cloud resources.

## Layout

```
shared/     @games/shared    the game catalogue + the API contract (Zod)
backend/    @games/backend   Express + pg + Kysely, SQL migrations at boot
frontend/   @games/frontend  React + Vite, one lazy chunk per game, service worker
e2e/        @games/e2e       Playwright against the built bundle
k8s/                         Deployment (app + auth sidecar) + Service + Ingress
docs/                        architecture, data model, adding a game, PWA notes
```

## Quickstart

Requires Node 24 and pnpm (`corepack enable`), plus Docker for the local database.

```bash
pnpm install
cp .env.example .env                       # fill in nothing to start; defaults work
docker compose up -d postgres              # or point DATABASE_URL at your own
pnpm --filter @games/shared build          # backend/frontend typecheck against it
pnpm dev                                   # http://localhost:5173
```

`pnpm dev` runs with `AUTH_MODE=dev`: a fixed local player, no auth service, no
sidecar. Migrations apply automatically at backend start.

To put the real sidecar in the loop, see [`.env.sidecar`](.env.sidecar) —
`pnpm dev:sidecar` plus the `homectl-auth-proxy` image with `DEV_FAKE_IDENTITY`.

### Everything else

```bash
pnpm build             # shared → backend bundle → frontend bundle (+ chunk check)
pnpm test              # shared + backend (Testcontainers Postgres) + frontend unit
pnpm test:e2e          # Playwright; needs `pnpm build` first
pnpm typecheck
docker compose up      # the actual image, migrations and all
```

Web Push is off unless VAPID keys are configured. For a local pair:

```bash
pnpm --filter @games/backend run vapid:generate   # append the output to .env
```

## Docs

| Doc | What it covers |
|-----|----------------|
| [architecture](docs/architecture.md) | Request flow, the code-splitting scheme, the single-container topology |
| [data-model](docs/data-model.md) | The jsonb-heavy schema and the generic gameplay API |
| [adding-a-game](docs/adding-a-game.md) | The whole procedure, start to finish |
| [pwa](docs/pwa.md) | What the service worker does, what it deliberately does not, and why |
| [deploy](docs/deploy.md) | Infra prerequisites, the pipeline, and how to verify a deploy |

Conventions and platform background: [`AGENTS.md`](AGENTS.md).
