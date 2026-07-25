import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";
import { logger } from "../logger.js";
import { createDevProvider } from "./devProvider.js";
import { createSidecarProvider } from "./sidecarProvider.js";
import type { AuthProvider } from "./types.js";

export type { AuthProvider, Principal } from "./types.js";

/**
 * Pick the auth provider from AUTH_MODE. `dev` is offline with a fixed user;
 * `sidecar` reads the verified X-Homectl-* headers. The default is computed in
 * config/env.ts and is `sidecar` in production.
 */
export function createAuthProvider(): AuthProvider {
  if (env.authMode === "dev") {
    logger.warn(
      { principal: env.devPrincipal.sub },
      "AUTH_MODE=dev — every request runs as a fixed local user. Never use this in production.",
    );
    return createDevProvider(env.devPrincipal);
  }
  return createSidecarProvider();
}

/**
 * Populate `req.principal`, or 401. Mounted on /api only — never on an HTML
 * route: a top-level navigation must reach the sidecar so it can run the login
 * redirect (homectl-auth ADR 0001).
 */
export function authMiddleware(provider: AuthProvider) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const principal = provider.authenticate(req);
    if (!principal) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    req.principal = principal;
    next();
  };
}

/** Gate a route on this app's role. The sidecar does not project the global
 * `isAdmin` claim into a header, so app roles are all we have — and all we want. */
export function requireRole(role: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (req.principal?.role !== role) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    next();
  };
}
