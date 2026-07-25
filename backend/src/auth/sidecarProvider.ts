import type { Request } from "express";
import type { AuthProvider, Principal } from "./types.js";

/**
 * Production identity: read the headers the homectl-auth-proxy injects.
 *
 * These are trustworthy only because the app container is pod-local — the
 * Service targets the sidecar's 4180, never the app's 8080, and the sidecar
 * strips every inbound `X-Homectl-*` / `Authorization` header before injecting
 * its own. If the app port were ever reachable directly, anyone could set these
 * headers and impersonate any player. See k8s/deployment.yml.
 */
export function createSidecarProvider(): AuthProvider {
  return {
    mode: "sidecar",
    authenticate(req: Request): Principal | null {
      const sub = header(req, "x-homectl-user");
      if (!sub) return null;

      return {
        sub,
        email: header(req, "x-homectl-email") ?? null,
        role: header(req, "x-homectl-role") ?? null,
      };
    },
  };
}

function header(req: Request, name: string): string | undefined {
  const value = req.get(name);
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
