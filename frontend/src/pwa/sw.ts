/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { CacheFirst, NetworkOnly } from "workbox-strategies";

/**
 * The service worker, hand-written on purpose.
 *
 * Its job is exactly one thing: serve the content-hashed bundles from cache so a
 * repeat visit — and switching between games — is instant. It deliberately does
 * NOT handle navigations.
 *
 * Why not: this app sits behind the homectl-auth-proxy forward-auth sidecar,
 * whose whole contract is that a top-level HTML navigation without a session gets
 * 302'd to central login. A worker that answers navigations from cache voids that
 * contract, and the failure mode is brutal — the cached shell boots, every API
 * call fails, a reload serves the shell again, and the player can never log in
 * without clearing site data. A generated `navigateFallback` does precisely this.
 * Every pitfall in homectl-reference/docs/pwa-auth-sidecar-pitfalls.md numbered
 * 1, 2 and 8 is a consequence of intercepting navigations, so we don't.
 *
 * The trade-off is explicit: no offline app shell. Assets are cached, navigations
 * always reach the network. Since playing requires an authenticated session
 * anyway, offline-first would have to be designed per game (with its own local
 * state and a sync story) rather than bolted on here. See docs/pwa.md.
 */
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// ── Never cache auth or API traffic ──────────────────────────────────────────
// Registered first so nothing below can shadow them. The `/auth/*` rule is what
// makes `/auth/relogin` — the app's single re-login entry point — safe to
// navigate to: it can never be answered from a cache.
registerRoute(({ url }) => url.pathname.startsWith("/auth/"), new NetworkOnly());
registerRoute(({ url }) => url.pathname.startsWith("/api/"), new NetworkOnly());
registerRoute(({ url }) => url.pathname === "/health", new NetworkOnly());

// ── Precache the build ───────────────────────────────────────────────────────
// injectManifest fills this in with the hashed assets only; index.html is
// excluded (see vite.config.ts) so no navigation can be served from here.
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// ── Anything else under /static/ ─────────────────────────────────────────────
// Icons and similar. Content-addressed or rarely changing, and admission is
// guarded so a login page or an opaque redirect can never land in the cache.
registerRoute(
  ({ url, request }) =>
    url.pathname.startsWith("/static/") && request.destination !== "document",
  new CacheFirst({
    cacheName: "static-assets-v1",
    plugins: [
      {
        cacheWillUpdate: async ({ response }) => {
          // Workbox's default cacheable statuses are [0, 200]; status 0 is an
          // opaque response and `redirected` means we chased a 302 to the auth
          // host and got HTML back. Neither belongs in a cache.
          if (response.status !== 200 || response.redirected) return null;
          const type = response.headers.get("content-type") ?? "";
          if (type.includes("text/html")) return null;
          return response;
        },
      },
    ],
  }),
);

// ── Update handshake ────────────────────────────────────────────────────────
// registerType is 'prompt', so a new worker waits until the page says go. The
// prompt is rendered outside the authenticated view as well as inside it, so a
// logged-out client can still apply an already-downloaded update.
self.addEventListener("message", (event: ExtendableMessageEvent) => {
  if ((event.data as { type?: string } | null)?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

// ── Web Push ────────────────────────────────────────────────────────────────
type PushPayload = {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  data?: Record<string, unknown>;
};

self.addEventListener("push", (event: PushEvent) => {
  let payload: PushPayload = {};
  try {
    payload = (event.data?.json() as PushPayload) ?? {};
  } catch {
    payload = { body: event.data?.text() ?? "" };
  }

  const url = typeof payload.url === "string" && payload.url.startsWith("/") ? payload.url : "/";

  event.waitUntil(
    self.registration.showNotification(payload.title ?? "Games", {
      body: payload.body ?? "",
      icon: "/static/icons/icon-192.png",
      badge: "/static/icons/icon-192.png",
      ...(payload.tag ? { tag: payload.tag } : {}),
      data: { ...payload.data, url },
    }),
  );
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const target = (event.notification.data as { url?: string } | null)?.url ?? "/";

  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clients) {
        if (new URL(client.url).pathname === target) {
          await client.focus();
          return;
        }
      }
      // A fresh window is a top-level navigation, so the sidecar handles login
      // if the session has since expired.
      await self.clients.openWindow(target);
    })(),
  );
});
