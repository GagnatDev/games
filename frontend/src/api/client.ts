import { confirmAuthenticated, reportSessionExpired } from "../auth/session";

/**
 * The only way this app talks to its API.
 *
 * The SPA is auth-agnostic — plain same-origin requests, no token, no knowledge
 * of auth.homectl.no. What it *does* have to do is tell "session expired" apart
 * from "offline", which behind a forward-auth sidecar is not obvious:
 *
 *  - An XHR without a session gets a `401`.
 *  - A request the sidecar redirects would, with default fetch semantics, be
 *    followed cross-origin to the auth host and reject as a CORS/network error —
 *    indistinguishable from being offline. `redirect: "manual"` turns that into
 *    an `opaqueredirect` response (reported as status 0) that we can classify.
 */

export class SessionExpiredError extends Error {
  constructor() {
    super("session expired");
    this.name = "SessionExpiredError";
  }
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    redirect: "manual",
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  // Any redirect here means the sidecar wants a login round-trip, not that the
  // network is down. Never let it fall through to an offline code path.
  if (
    response.type === "opaqueredirect" ||
    response.status === 0 ||
    (response.status >= 300 && response.status < 400) ||
    response.status === 401
  ) {
    reportSessionExpired();
    throw new SessionExpiredError();
  }

  confirmAuthenticated();

  if (response.status === 204) return undefined as T;

  const body = await readBody(response);
  if (!response.ok) {
    const detail = body as { error?: string; message?: string } | null;
    throw new ApiError(
      response.status,
      detail?.error ?? "request_failed",
      detail?.message ?? `${response.status} ${response.statusText}`,
      body,
    );
  }

  return body as T;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  put: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: "PUT", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    apiFetch<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  del: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, {
      method: "DELETE",
      ...(body ? { body: JSON.stringify(body) } : {}),
    }),
};

async function readBody(response: Response): Promise<unknown> {
  const type = response.headers.get("content-type") ?? "";
  if (!type.includes("application/json")) return await response.text();
  try {
    return await response.json();
  } catch {
    return null;
  }
}
