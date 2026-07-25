# Working in `games` (for agents)

`games` is a homectl platform app. Read
[`homectl-reference`](https://github.com/GagnatDev/homectl-reference) first —
`docs/platform-overview.md`, then the focused doc for your task — and don't
re-derive what it already documents.

## The invariants

1. **The app id is `games`.** It is the Postgres database and user, the auth
   `clientId`, the secret prefix and the k8s resource names. Don't rename it.
2. **Never touch infra by hand.** Cloud resources are Terraform-managed in
   `homectl-infra`; `*-terraform-secrets` and `*-vapid-secrets` are generated.
   Change the Terraform and apply.
3. **The app container is pod-local.** The Service targets the sidecar's `4180`,
   never the app's `8080`. `X-Homectl-*` is trustworthy *only* because of that. If
   you are ever tempted to expose 8080, stop — it is impersonation-as-a-service.
4. **The database schema stays generic.** It describes players, saves, progression,
   events and scores. It must never learn what a ship, a port or a cargo is: those
   live inside jsonb documents the game owns. See [docs/data-model.md](docs/data-model.md).
5. **Games are lazily imported, always.** A static import of a game from the shell
   silently undoes the code splitting; `frontend/scripts/check-chunks.mjs` fails the
   build when it happens. Don't work around it — fix the import.
6. **The service worker must not handle navigations.** Behind a forward-auth
   sidecar, a cached app shell makes login unreachable. Read
   [docs/pwa.md](docs/pwa.md) before touching `frontend/src/pwa/`.
7. **Prefer dev auth locally.** `AUTH_MODE=dev` runs the whole stack — including
   tests and e2e — with no auth service.

## Where things are

- Catalogue (the source of truth for what games exist): `shared/src/catalogue.ts`
- API contract: `shared/src/api.ts` · Frontend game registry: `frontend/src/games/registry.ts`
- Migrations: `backend/migrations/*.sql` (plain SQL, run at boot, advisory-locked)
- Auth providers: `backend/src/auth/` · JIT user: `backend/src/middleware/resolveUser.ts`
- Session recovery (the loop guard): `frontend/src/auth/session.ts`

## Before you push

```bash
pnpm typecheck && pnpm test && pnpm build
```

e2e needs a build first: `pnpm build && pnpm test:e2e`.

## Git & commits

Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
Feature branches, PRs that `Closes #N` where an issue exists.
