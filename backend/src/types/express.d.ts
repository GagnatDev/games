import type { Principal } from "../auth/types.js";
import type { AppUser } from "../storage/userRepository.js";

declare global {
  namespace Express {
    interface Request {
      /** Identity from the auth provider (sidecar headers or the dev principal). */
      principal?: Principal;
      /** This app's user row, provisioned just-in-time on first request. */
      appUser?: AppUser;
      /** Shorthand for `appUser.id` — the id every row is scoped by. */
      userId?: string;
    }
  }
}

export {};
