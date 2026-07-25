import type { Request } from "express";
import type { AuthProvider, Principal } from "./types.js";

/**
 * Local/test identity: a fixed principal, so the whole stack runs with no auth
 * service and no sidecar (`pnpm dev`, backend tests, Playwright e2e).
 *
 * `x-dev-sub` overrides the subject per request, which is how multi-player
 * scenarios are exercised in tests without real logins.
 */
export function createDevProvider(fixed: {
  sub: string;
  email: string;
  role: string;
}): AuthProvider {
  return {
    mode: "dev",
    authenticate(req: Request): Principal {
      const sub = req.get("x-dev-sub")?.trim() || fixed.sub;
      const email =
        req.get("x-dev-email")?.trim() ||
        (sub === fixed.sub ? fixed.email : `${sub}@dev.local`);

      return { sub, email, role: req.get("x-dev-role")?.trim() || fixed.role };
    },
  };
}
