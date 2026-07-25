import { afterAll, describe, expect, it } from "vitest";
import { closePool } from "../../db/pool.js";
import { api } from "../../test/helpers.js";

afterAll(async () => {
  await closePool();
});

describe("GET /health", () => {
  it("reports the auth mode and whether push is configured", async () => {
    const res = await api().get("/health");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "ok", authMode: "dev", push: false });
  });

  it("sets the baseline security headers", async () => {
    const res = await api().get("/health");

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
  });
});

describe("GET /auth/relogin", () => {
  it("bounces back to where the player was", async () => {
    const res = await api().get("/auth/relogin?return_to=/landfall%3Fslot%3Ddefault");

    expect(res.status).toBe(302);
    expect(res.headers["location"]).toBe("/landfall?slot=default");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("refuses to be an open redirect", async () => {
    for (const target of [
      "https://evil.example/",
      "//evil.example/",
      "/\\evil.example",
      "not-a-path",
    ]) {
      const res = await api().get(
        `/auth/relogin?return_to=${encodeURIComponent(target)}`,
      );
      expect(res.status).toBe(302);
      expect(res.headers["location"]).toBe("/");
    }
  });
});

describe("unmatched api paths", () => {
  it("answer JSON rather than the SPA shell", async () => {
    const res = await api().get("/api/nope");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "not_found" });
  });
});
