import { existsSync } from "node:fs";
import { join } from "node:path";
import express, { type Express, type Request, type Response } from "express";
import { pinoHttp } from "pino-http";
import { authMiddleware, createAuthProvider } from "./auth/index.js";
import { env } from "./config/env.js";
import { logger } from "./logger.js";
import { asyncHandler, errorHandler } from "./middleware/errors.js";
import { resolveUser } from "./middleware/resolveUser.js";
import { pool } from "./db/pool.js";
import { gamesRouter } from "./routes/games.js";
import { meRouter } from "./routes/me.js";
import { pushRouter } from "./routes/push.js";

/**
 * One container serves both the built SPA and the API (the platform's
 * single-container topology). Everything is same-origin, so the SPA needs no
 * CORS, no tokens, and no knowledge of auth.homectl.no.
 */
export function createApp(): Express {
  const app = express();
  app.disable("x-powered-by");

  if (!env.isTest) {
    app.use(
      pinoHttp({
        logger,
        // Probes every 10s would otherwise dominate the log.
        autoLogging: { ignore: (req) => req.url === "/health" },
      }),
    );
  }

  app.use(securityHeaders);
  app.use(express.json({ limit: "1mb" }));

  // ── Health ────────────────────────────────────────────────────────────────
  // Unauthenticated on purpose: kubelet probes hit the app container directly on
  // 8080, bypassing the sidecar entirely.
  app.get(
    "/health",
    asyncHandler(async (_req, res) => {
      await pool.query("SELECT 1");
      res.json({ status: "ok", authMode: env.authMode, push: env.push !== null });
    }),
  );

  // ── Session recovery ──────────────────────────────────────────────────────
  // The single path the SPA navigates to when it detects an expired session. In
  // production it never actually reaches this handler while logged out: the
  // sidecar sees an HTML navigation with no session and 302s to central login,
  // returning here afterwards, at which point we bounce to where the player was.
  //
  // It has to be a real top-level navigation to a `/auth/*` path, because the
  // service worker is required to treat `/auth/*` as NetworkOnly — a cached
  // response here is the classic unrecoverable PWA login loop.
  app.get("/auth/relogin", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.redirect(302, sanitizeReturnTo(req.query["return_to"]));
  });

  // ── API ───────────────────────────────────────────────────────────────────
  const auth = createAuthProvider();
  const api = express.Router();
  api.use(authMiddleware(auth), resolveUser());
  api.use(meRouter());
  api.use(gamesRouter());
  api.use(pushRouter());
  app.use("/api", api);

  // Unmatched API/auth paths answer JSON, never the SPA shell — a cached HTML
  // body in a data cache is another way the PWA ends up rendering a login page
  // where data should be.
  app.all(/^\/(api|auth)\//, (_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  // ── Static SPA ────────────────────────────────────────────────────────────
  mountSpa(app);

  app.use(errorHandler());
  return app;
}

/**
 * The SPA is built with `base: '/static/'`, so every hashed asset, the web
 * manifest and the service worker live under `/static/` — the one prefix the auth
 * sidecar proxies without a session (`BYPASS_STATIC_AUTH`, default true). That is
 * deliberate: it lets a logged-out client fetch an updated service worker, which
 * is otherwise impossible behind a forward-auth proxy and pins installed clients
 * to a stale build forever.
 *
 * `index.html` stays auth-gated and is served for every other path, so a
 * top-level navigation always reaches the sidecar.
 */
function mountSpa(app: Express): void {
  const webRoot = env.webRoot;
  if (!webRoot) {
    logger.info("WEB_ROOT unset — API only (Vite serves the SPA in dev)");
    return;
  }

  if (!existsSync(webRoot)) {
    throw new Error(`WEB_ROOT does not exist: ${webRoot}`);
  }

  app.use(
    "/static",
    express.static(webRoot, {
      index: false,
      fallthrough: false,
      setHeaders(res, path) {
        if (path.endsWith("sw.js")) {
          // Never cache the worker script itself, and let a worker served from
          // /static/ control the whole origin.
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("Service-Worker-Allowed", "/");
          return;
        }
        if (path.endsWith(".webmanifest")) {
          res.setHeader("Cache-Control", "public, max-age=3600");
          return;
        }
        if (path.includes("/assets/")) {
          // Content-hashed by Vite.
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
          return;
        }
        res.setHeader("Cache-Control", "public, max-age=3600");
      },
    }),
  );

  const indexHtml = join(webRoot, "index.html");
  app.get(/^\/(?!static\/).*/, (_req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.sendFile(indexHtml);
  });
}

function securityHeaders(_req: Request, res: Response, next: () => void): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "img-src 'self' data: blob:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self'",
      "connect-src 'self'",
      "worker-src 'self'",
      "manifest-src 'self'",
    ].join("; "),
  );
  next();
}

/**
 * Only ever redirect to a relative path on this origin — the value comes from a
 * query string, so an absolute URL here would be an open redirect.
 */
function sanitizeReturnTo(raw: unknown): string {
  if (typeof raw !== "string" || !raw.startsWith("/")) return "/";
  if (raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  if (raw.includes("\\") || raw.includes("://")) return "/";
  if (/[\u0000-\u001f\u007f]/.test(raw)) return "/";
  return raw;
}
