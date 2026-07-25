/**
 * Session-expiry recovery — one funnel, loop-guarded.
 *
 * Behind the homectl-auth-proxy every failure mode of "your session is gone"
 * arrives as something that looks like a network problem (see
 * homectl-reference/docs/pwa-auth-sidecar-pitfalls.md). This module is the single
 * place that turns those signals into exactly one full-page navigation, and gives
 * up visibly instead of ping-ponging with the auth host.
 *
 * Rules encoded here:
 *  - Recovery is always a top-level navigation to `/auth/relogin`, never a
 *    client-side route change and never `location.reload()` — a reload can be
 *    answered from the service-worker cache, a navigation to `/auth/*` cannot
 *    (the worker registers it NetworkOnly).
 *  - The player's place is preserved as `return_to`.
 *  - Concurrent failures on one screen collapse into one navigation.
 *  - At most MAX_ATTEMPTS navigations per WINDOW_MS, counted in sessionStorage so
 *    the count survives the round-trip to the auth host in this tab.
 *  - A confirmed-authenticated response clears the budget.
 */

const ATTEMPTS_KEY = "games.reauth";
const MAX_ATTEMPTS = 3;
const WINDOW_MS = 60_000;

type Attempts = { count: number; first: number };

let navigationStarted = false;
let givenUp = false;
const listeners = new Set<(givenUp: boolean) => void>();

/** Subscribe to "we stopped trying to re-authenticate" so the UI can say so. */
export function onSessionLost(listener: (givenUp: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function sessionGivenUp(): boolean {
  return givenUp;
}

/**
 * Call from anywhere that observes an expired session. Safe to call many times —
 * only the first call in a page lifetime navigates.
 */
export function reportSessionExpired(): void {
  if (navigationStarted || givenUp) return;

  const attempts = readAttempts();
  if (attempts.count >= MAX_ATTEMPTS) {
    givenUp = true;
    listeners.forEach((listener) => listener(true));
    return;
  }

  writeAttempts({ count: attempts.count + 1, first: attempts.first });
  navigationStarted = true;
  startInteractiveLogin();
}

/**
 * The explicit "log in again" action, from the session-expired screen. It resets
 * the budget first: this one is the player asking, not an automatic retry.
 */
export function retryLogin(): void {
  clearAttempts();
  givenUp = false;
  navigationStarted = true;
  startInteractiveLogin();
}

/** Clear the attempt budget once we know the session is good. */
export function confirmAuthenticated(): void {
  if (givenUp) {
    givenUp = false;
    listeners.forEach((listener) => listener(false));
  }
  clearAttempts();
}

/**
 * The one indirection in this module: a real browser navigation, behind an object
 * so tests can observe it (jsdom refuses to navigate).
 */
export const browserNavigation = {
  assign(url: string): void {
    window.location.assign(url);
  },
  here(): string {
    return window.location.pathname + window.location.search + window.location.hash;
  },
};

/**
 * A real top-level navigation to a sidecar-owned path. While logged out the
 * sidecar answers this with a 302 to central login and brings the player back
 * here afterwards; the backend then redirects to `return_to`.
 */
function startInteractiveLogin(): void {
  const returnTo = browserNavigation.here();
  browserNavigation.assign(`/auth/relogin?return_to=${encodeURIComponent(returnTo)}`);
}

function readAttempts(): Attempts {
  const fresh: Attempts = { count: 0, first: Date.now() };
  try {
    const raw = window.sessionStorage.getItem(ATTEMPTS_KEY);
    if (!raw) return fresh;
    const parsed = JSON.parse(raw) as Partial<Attempts>;
    if (typeof parsed.count !== "number" || typeof parsed.first !== "number") return fresh;
    // Outside the window the budget resets, so an expiry hours later gets fresh
    // attempts rather than inheriting an old, exhausted count.
    if (Date.now() - parsed.first > WINDOW_MS) return fresh;
    return { count: parsed.count, first: parsed.first };
  } catch {
    return fresh;
  }
}

function writeAttempts(attempts: Attempts): void {
  try {
    window.sessionStorage.setItem(ATTEMPTS_KEY, JSON.stringify(attempts));
  } catch {
    // Private mode / storage full: the in-page flag still collapses the burst.
  }
}

function clearAttempts(): void {
  try {
    window.sessionStorage.removeItem(ATTEMPTS_KEY);
  } catch {
    // ignore
  }
}
