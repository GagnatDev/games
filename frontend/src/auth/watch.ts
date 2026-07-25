import type { SessionResponse } from "@games/shared";
import { api, SessionExpiredError } from "../api/client";
import { confirmAuthenticated } from "./session";

/**
 * Re-check the session when the app comes back to the foreground.
 *
 * On mobile the session usually expires while the PWA is backgrounded, and the
 * first sign of it is whatever request the player's next tap happens to fire —
 * a mid-action failure. Probing on focus instead means the sidecar gets to
 * re-establish the session (one silent round-trip, if the central SSO session is
 * still alive) before the player touches anything.
 *
 * `apiFetch` already funnels a 401/redirect into the recovery path, so this only
 * has to make the request and throttle it.
 */
const THROTTLE_MS = 5_000;

export function startSessionWatch(): () => void {
  let lastCheck = 0;
  let inFlight = false;

  const check = () => {
    if (document.visibilityState !== "visible") return;
    const now = Date.now();
    if (inFlight || now - lastCheck < THROTTLE_MS) return;
    lastCheck = now;
    inFlight = true;

    api
      .get<SessionResponse>("/api/session")
      .then(() => confirmAuthenticated())
      .catch((err: unknown) => {
        // Recovery already started inside apiFetch; anything else is a genuine
        // network blip and not worth surfacing from a background probe.
        if (!(err instanceof SessionExpiredError)) return;
      })
      .finally(() => {
        inFlight = false;
      });
  };

  document.addEventListener("visibilitychange", check);
  window.addEventListener("focus", check);

  return () => {
    document.removeEventListener("visibilitychange", check);
    window.removeEventListener("focus", check);
  };
}
