import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The whole reason this wrapper exists: behind the auth sidecar an expired session
 * arrives as a redirect (or a 401), and with default fetch semantics a redirect
 * chased cross-origin is indistinguishable from being offline. Misclassifying it
 * strands the player in a stale offline view instead of logging them back in.
 */
function response(init: {
  status: number;
  type?: ResponseType;
  body?: unknown;
  contentType?: string;
}): Response {
  return {
    status: init.status,
    statusText: "",
    ok: init.status >= 200 && init.status < 300,
    type: init.type ?? "default",
    headers: new Headers(
      init.contentType ? { "content-type": init.contentType } : undefined,
    ),
    json: async () => init.body,
    text: async () => JSON.stringify(init.body ?? ""),
  } as unknown as Response;
}

let expired: ReturnType<typeof vi.fn>;
let confirmed: ReturnType<typeof vi.fn>;

beforeEach(() => {
  expired = vi.fn();
  confirmed = vi.fn();
  vi.resetModules();
  vi.doMock("../auth/session", () => ({
    reportSessionExpired: expired,
    confirmAuthenticated: confirmed,
  }));
});

afterEach(() => {
  vi.doUnmock("../auth/session");
  vi.restoreAllMocks();
});

async function client() {
  return await import("./client");
}

describe("apiFetch", () => {
  it("requests with manual redirect handling and same-origin credentials", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        response({ status: 200, body: { ok: true }, contentType: "application/json" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { api } = await client();
    await expect(api.get("/api/me")).resolves.toEqual({ ok: true });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.redirect).toBe("manual");
    expect(init.credentials).toBe("same-origin");
    expect(confirmed).toHaveBeenCalled();
  });

  it("treats an opaque redirect as an expired session, not a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ status: 0, type: "opaqueredirect" })),
    );

    const { api, SessionExpiredError } = await client();
    await expect(api.get("/api/me")).rejects.toBeInstanceOf(SessionExpiredError);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("treats a raw 3xx the same way", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ status: 302 })));

    const { api, SessionExpiredError } = await client();
    await expect(api.get("/api/me")).rejects.toBeInstanceOf(SessionExpiredError);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("treats a 401 the same way", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ status: 401 })));

    const { api, SessionExpiredError } = await client();
    await expect(api.get("/api/me")).rejects.toBeInstanceOf(SessionExpiredError);
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it("surfaces a real API error with its code, without touching the session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({
          status: 409,
          body: { error: "revision_conflict", message: "the save moved on" },
          contentType: "application/json",
        }),
      ),
    );

    const { api, ApiError } = await client();
    const failure = await api
      .put("/api/games/landfall/saves/default", {})
      .catch((err: unknown) => err);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ status: 409, code: "revision_conflict" });
    expect(expired).not.toHaveBeenCalled();
  });

  it("returns undefined for 204 rather than trying to parse a body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ status: 204 })));

    const { api } = await client();
    await expect(api.del("/api/push/subscriptions", { endpoint: "x" })).resolves.toBeUndefined();
  });

  it("sets a JSON content type only when there is a body", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        response({ status: 200, body: {}, contentType: "application/json" }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { api } = await client();
    await api.get("/api/games");
    await api.post("/api/games/landfall/events", { events: [] });

    const [, getInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [, postInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(getInit.headers).not.toHaveProperty("Content-Type");
    expect(postInit.headers).toMatchObject({ "Content-Type": "application/json" });
  });
});
