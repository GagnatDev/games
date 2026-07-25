/**
 * Service-worker registration.
 *
 * Two details matter:
 *
 *  1. The script lives at `/static/sw.js` but is registered with `scope: '/'`.
 *     `/static/` is the only prefix the auth sidecar proxies without a session,
 *     so an update check for the worker succeeds while logged out — otherwise the
 *     check is redirected to the auth host and installed clients stay pinned to
 *     whatever build they have forever. The backend sends
 *     `Service-Worker-Allowed: /` to permit the wider scope.
 *  2. Updates are prompted, never silent, and the prompt is also rendered on the
 *     session-expired screen, so a waiting worker can be applied by a client that
 *     cannot currently log in.
 */

const SW_URL = "/static/sw.js";

export type UpdateState = {
  /** A new worker is installed and waiting for permission to take over. */
  updateReady: boolean;
  /** Tell the waiting worker to activate, then reload. */
  applyUpdate: () => void;
};

type Listener = (state: { updateReady: boolean }) => void;

let waiting: ServiceWorker | null = null;
let reloading = false;
const listeners = new Set<Listener>();

export function onUpdateStateChange(listener: Listener): () => void {
  listeners.add(listener);
  listener({ updateReady: waiting !== null });
  return () => listeners.delete(listener);
}

export function applyUpdate(): void {
  if (!waiting) return;
  waiting.postMessage({ type: "SKIP_WAITING" });
}

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  // Dev runs without a worker; every problem it guards against is a production
  // one, and in dev it only fights hot reload.
  if (!import.meta.env.PROD) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(SW_URL, { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        trackWaiting(registration);

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          installing?.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              setWaiting(registration.waiting ?? installing);
            }
          });
        });
      })
      .catch(() => {
        // A failed registration (or a failed update check while logged out) must
        // never break the app — it just means no precache this session.
      });

    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  });
}

function trackWaiting(registration: ServiceWorkerRegistration): void {
  if (registration.waiting && navigator.serviceWorker.controller) {
    setWaiting(registration.waiting);
  }
}

function setWaiting(worker: ServiceWorker | null): void {
  waiting = worker;
  listeners.forEach((listener) => listener({ updateReady: waiting !== null }));
}
