import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { logger } from "../logger.js";

/** Thrown by route code for a deliberate, client-visible failure. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message ?? code);
  }
}

export function notFound(code = "not_found"): HttpError {
  return new HttpError(404, code);
}

/** Wrap an async handler so a rejected promise reaches the error middleware. */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

function expressStatus(err: unknown): number | null {
  const candidate = err as { status?: unknown; statusCode?: unknown } | null;
  const status = candidate?.status ?? candidate?.statusCode;
  return typeof status === "number" && status >= 400 && status < 500 ? status : null;
}

export function errorHandler() {
  return (err: unknown, _req: Request, res: Response, next: NextFunction): void => {
    if (res.headersSent) {
      next(err);
      return;
    }

    if (err instanceof ZodError) {
      res.status(400).json({ error: "invalid_request", details: err.issues });
      return;
    }

    if (err instanceof HttpError) {
      res.status(err.status).json({
        error: err.code,
        ...(err.message !== err.code ? { message: err.message } : {}),
        ...(err.details !== undefined ? { details: err.details } : {}),
      });
      return;
    }

    // Express middleware signals client errors with a status on the error —
    // `express.static` with `fallthrough: false` throws a 404 that way. Answer it
    // as the client error it is, not as a server fault.
    const status = expressStatus(err);
    if (status !== null) {
      res.status(status).json({ error: status === 404 ? "not_found" : "bad_request" });
      return;
    }

    logger.error(
      { err: err instanceof Error ? err.stack : String(err) },
      "unhandled request error",
    );
    res.status(500).json({ error: "internal_error" });
  };
}
