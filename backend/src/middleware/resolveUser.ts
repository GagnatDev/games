import type { NextFunction, Request, Response } from "express";
import { upsertByAuthSub } from "../storage/userRepository.js";

/**
 * Mount straight after `authMiddleware`. Maps the auth `sub` to this app's own
 * user row (creating it on first sight) and exposes `req.userId` — the id every
 * query scopes by. Ids from the client are never trusted.
 */
export function resolveUser() {
  return (req: Request, res: Response, next: NextFunction): void => {
    const principal = req.principal;
    if (!principal) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }

    upsertByAuthSub({
      authSub: principal.sub,
      email: principal.email,
      role: principal.role,
    })
      .then((user) => {
        req.appUser = user;
        req.userId = user.id;
        next();
      })
      .catch(next);
  };
}
