# PWA notes

`games` is installable, precaches its bundles, and receives Web Push. It does
**not** serve the app shell offline. That is a decision, not an omission, and this
document explains it — plus the specific mitigations that keep an installed client
from getting stuck.

Background reading, all of it earned in production on this platform:
[`homectl-reference/docs/pwa-auth-sidecar-pitfalls.md`](https://github.com/GagnatDev/homectl-reference/blob/main/docs/pwa-auth-sidecar-pitfalls.md).

## The core tension

The auth sidecar's contract is that a top-level HTML navigation without a session
is `302`'d to central login, and an XHR gets a `401`. Both assume the request
**reaches the network**. A service worker that answers navigations from cache
silently voids that assumption, and the failure is unrecoverable without clearing
site data: the cached shell boots, every API call fails, a reload serves the shell
again, and the player can never log in.

## What the service worker does

`frontend/src/pwa/sw.ts`, built with `injectManifest` so it is ours, not generated.

- **Precaches the hashed assets** — the shell, the React vendor chunk, each game's
  chunk, the icons. This is where the load-time win lives, and it is the point of
  the per-game splitting.
- **`NetworkOnly` for `/auth/*`, `/api/*` and `/health`**, registered before every
  other route so nothing can shadow them.
- **Does not intercept navigations at all.** No `navigateFallback`, and
  `index.html` is excluded from the precache manifest (`vite.config.ts`). Pitfalls
  1, 2 and 8 are all consequences of intercepting navigations, so we don't.
- **Guards cache admission** on the one runtime cache: only status exactly `200`,
  never `response.redirected`, never `text/html`. Workbox's default cacheable
  statuses are `[0, 200]`, and a redirect chased to the login page comes back as a
  perfectly cacheable `200` HTML body — that is how a data cache ends up serving a
  login page where JSON should be.
- **Handles `push` and `notificationclick`**, opening an in-app path. Opening a
  window is a top-level navigation, so an expired session logs in normally.

The trade-off: offline, the player gets the browser's offline page. Since playing
requires an authenticated session anyway, meaningful offline support has to be
designed per game — its own local state and its own merge rules — rather than
bolted onto the shell. The `revision` field on saves is the hook for that day.

## The mitigations

### `/static/` is public, and the worker lives there

The SPA is built with `base: '/static/'` and the sidecar proxies that prefix
without a session (`BYPASS_STATIC_AUTH`, default true). So `sw.js` is reachable
while logged out.

This matters because behind a forward-auth proxy *everything* is auth-gated,
including the service-worker script — the browser's update check for an auth-gated
`sw.js` is redirected to the auth host and fails, pinning installed clients to
whatever build they have, forever (pitfall 6).

The script is served from `/static/sw.js` but registered with `scope: '/'`, which
the backend permits with `Service-Worker-Allowed: /`. `sw.js` itself is
`no-store`; hashed assets are `immutable`.

### One re-login path, loop-guarded

`frontend/src/auth/session.ts` is the only place that reacts to an expired
session, and it:

- navigates — a **real top-level navigation**, never `location.reload()` (which the
  worker could answer from cache) and never a client-side route change — to
  `/auth/relogin?return_to=<where the player was>`;
- collapses concurrent failures: a screen with N in-flight requests produces N
  expiry events and exactly one navigation;
- caps attempts at 3 per minute, counted in `sessionStorage` so the count survives
  the round-trip to the auth host, then renders a visible "session expired" screen
  instead of ping-ponging with the auth host;
- clears that budget as soon as a request confirms the session is good.

`/auth/relogin` is a backend route that redirects to a sanitised `return_to`. While
logged out it never actually runs: the sidecar intercepts the navigation, logs the
player in, and sends them back here, at which point it bounces them to where they
were. It sits under `/auth/*` precisely because the worker treats that prefix as
`NetworkOnly`.

### Redirects are not "offline"

`frontend/src/api/client.ts` sends every API request with `redirect: "manual"`.
With default semantics a redirect to the auth host is followed cross-origin and
rejects as a CORS/network error — indistinguishable from being offline, which
offline-capable clients deliberately swallow. Manual redirect turns it into an
`opaqueredirect` response (status `0`) that is classified as *session expired* and
routed into the recovery path above, alongside a plain `401` or a raw `3xx`.

### The session is re-checked on focus

`frontend/src/auth/watch.ts` probes `/api/session` on `visibilitychange`/focus,
throttled. On mobile a session usually expires while the app is backgrounded and
the first sign of it is whatever request the player's next tap fires. Probing first
lets the sidecar re-establish the session in one silent round-trip.

### The update prompt lives outside the auth gate

`UpdateBanner` is rendered in the shell layout **and** on the session-expired
screen. If the only "update now" affordance were inside the authenticated app, a
client that cannot log in could never activate an already-downloaded fix.

## Checklist, mapped

| Pitfall | Mitigation here |
|---|---|
| 1 · cached shell swallows login | No navigation handling; `index.html` not precached; `/auth/*` `NetworkOnly`; re-login is a full navigation |
| 2 · OAuth callback served from cache | Same — no fallback exists to serve it |
| 3 · login redirect looks like "offline" | `redirect: "manual"` + `opaqueredirect`/`3xx` ⇒ session expired |
| 4 · runtime caches poisoned by auth responses | `cacheWillUpdate`: `200` only, not redirected, not HTML |
| 5 · re-login loops | One funnel, `return_to` preserved, concurrent collapse, 3-per-minute cap, visible dead end |
| 6 · logged-out client cannot update the worker | `sw.js` under public `/static/`, `scope: '/'`, prompt outside the auth gate |
| 7 · session expires while backgrounded | `/api/session` probe on focus |
| 8 · pre-fix installs cannot self-heal | Not applicable: the sidecar is in front from day one, so no install predates these fixes |
| 9 · spurious logouts each token lifetime | Server-side in homectl-auth (refresh rotation grace); the attempt cap is the backstop |

## Local development

No service worker in dev (`registerServiceWorker` returns early unless
`import.meta.env.PROD`, and `devOptions.enabled` is false). Every problem it guards
against is a production one, and in dev it only fights hot reload. Test worker
behaviour against a real build: `pnpm build` then serve it through the backend with
`WEB_ROOT` set.
