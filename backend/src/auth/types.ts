import type { Request } from "express";

/** The identity homectl-auth supplies. The app owns everything past this point. */
export type Principal = {
  /** Stable auth-service user id (JWT `sub`). Joins to `users.auth_sub`. */
  sub: string;
  email: string | null;
  /** This app's role for the user, from apps.json (`player` | `admin`). */
  role: string | null;
};

export type AuthProvider = {
  readonly mode: "dev" | "sidecar";
  /** Returns the principal, or null when the request carries no identity. */
  authenticate(req: Request): Principal | null;
};
