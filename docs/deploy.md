# Deploy

`games` runs on Kapsule in the `homectl` namespace, behind the shared nginx ingress.
Background: [`homectl-reference/skills/deploy-app`](https://github.com/GagnatDev/homectl-reference/blob/main/skills/deploy-app/SKILL.md).

## One-time prerequisites

1. **Terraform** (`homectl-infra`) — the app is registered in the `applications`
   map as:

   ```hcl
   games = { postgres = true, auth = true, vapid = true }
   ```

   `terraform apply` then creates:
   - the Postgres database + non-admin user, both named `games`;
   - `games-terraform-secrets` with `DATABASE_URL`, `AUTH_CLIENT_ID`,
     `AUTH_CLIENT_SECRET`, `COOKIE_KEY`;
   - `games-vapid-secrets` with `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
     `VAPID_SUBJECT`;
   - the matching `GAMES_CLIENT_SECRET` entry in the shared `auth-client-secrets`.

2. **homectl-auth** — the `games` client is registered in `apps.json`
   (`k8s/configmap.yaml`), with `clientSecretEnv: GAMES_CLIENT_SECRET`,
   `allowedRedirectUris: ["https://games.homectl.no/auth/callback"]` and the
   `player` / `admin` roles.

   **Ordering matters:** `terraform apply` first, so `auth-client-secrets` has the
   key, then roll out the auth ConfigMap, then
   `kubectl -n homectl rollout restart deploy/auth` — Secret-backed env vars do not
   hot-reload, and an `apps.json` naming a missing env var crashloops the auth pod.

3. **DNS** — an `A` record for `games.homectl.no` pointing at the reserved ingress
   LB IP (`terraform -chdir=terraform output ingress_ip`). cert-manager issues the
   TLS certificate once the Ingress exists.

4. **GitHub Actions secrets** in this repo: `SCW_ACCESS_KEY`, `SCW_SECRET_KEY`,
   `SCW_ORGANIZATION_ID`, `SCW_PROJECT_ID`, `K8S_CLUSTER_ID`.

## The pipeline

`ci.yaml` on every PR and push to `main`: typecheck, shared/backend/frontend tests
(including the per-game chunk check), then Playwright e2e against the built bundle.

`deploy.yml` on a successful CI run on `main` (or manual dispatch):

1. `docker build` and push `rg.fr-par.scw.cloud/homectl/games:<sha>` and `:latest`.
2. Fetch the kubeconfig for `K8S_CLUSTER_ID`.
3. Substitute `$IMAGE_TAG` into `k8s/deployment.yml`, `kubectl apply`, then
   `kubectl rollout status deployment/games -n homectl --timeout=300s`.

Migrations run inside the container at boot, before it starts listening; the
startup probe allows ~5 minutes for that.

## Verifying a deploy

```bash
kubectl -n homectl get pods -l app=games          # 2/2 containers ready
kubectl -n homectl logs deploy/games -c games     # migrations ran once, then listening
```

Then in a browser:

1. `https://games.homectl.no` in a fresh session → redirected to
   `auth.homectl.no`, signed in, returned. There is an `hs_session` cookie and
   **no** token in JS.
2. The hub lists **Landfall**. Open it: the network panel shows a
   `game-landfall-*.js` request that was absent on the hub — the split is real.
3. On `/landfall`, found a company (pick a ship, **Sign the papers**) → the save
   status shows *Saved · revision 1*. Reload: the company survives, so Postgres
   and JIT user provisioning both work.
4. `/profile` → set a display name, toggle a preference, reload. Both persist in the
   `users` row's jsonb `profile`.
5. `/profile` → **Enable notifications**, then **Send a test**. A notification
   arrives, which proves `games-vapid-secrets` reached the pod and the keypair is
   accepted by the browser's push service. If the card says *no VAPID keys*, the
   Secret is missing — apply Terraform and
   `kubectl -n homectl rollout restart deploy/games`.
6. Install the app (browser install prompt) and confirm the icon and standalone
   window. `https://games.homectl.no/static/sw.js` must return `200` **while logged
   out** — that is the check that installed clients can still receive updates.

## Troubleshooting

| Symptom | Usual cause |
|---|---|
| `ImagePullBackOff` | Registry login or image tag mismatch |
| `CrashLoopBackOff` | Env or DB. Check `games-terraform-secrets` exists and the Zod config error in the logs |
| Auth pod crashlooping after the auth rollout | `apps.json` references `GAMES_CLIENT_SECRET` before `terraform apply` created it |
| 404 on the host, or no certificate | Ingress host vs DNS mismatch, or cert-manager still issuing (`kubectl -n homectl get certificate games-tls`) |
| Login loops | Check `allowedRedirectUris` contains exactly `https://games.homectl.no/auth/callback`, and that the Service targets `4180`, not `8080` |
| Push says *no VAPID keys* | `vapid = true` not applied, or the pod predates the Secret — rollout restart |

Never expose the app's `8080` through a Service or Ingress path: the
`X-Homectl-*` headers are only trustworthy because all traffic goes through the
sidecar.
