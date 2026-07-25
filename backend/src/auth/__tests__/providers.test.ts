import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { authMiddleware, requireRole } from "../index.js";
import { createDevProvider } from "../devProvider.js";
import { createSidecarProvider } from "../sidecarProvider.js";

function appWith(provider: ReturnType<typeof createSidecarProvider>) {
  const app = express();
  app.get("/who", authMiddleware(provider), (req, res) => {
    res.json(req.principal);
  });
  app.get("/admin-only", authMiddleware(provider), requireRole("admin"), (_req, res) => {
    res.json({ ok: true });
  });
  return app;
}

describe("sidecar provider", () => {
  const app = appWith(createSidecarProvider());

  it("reads the identity the proxy injects", async () => {
    const res = await request(app)
      .get("/who")
      .set("x-homectl-user", "user-uuid")
      .set("x-homectl-email", "skipper@homectl.no")
      .set("x-homectl-role", "player");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      sub: "user-uuid",
      email: "skipper@homectl.no",
      role: "player",
    });
  });

  it("401s when the identity header is absent", async () => {
    const res = await request(app).get("/who");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthenticated" });
  });

  it("treats a role-less user as having no role", async () => {
    const res = await request(app).get("/who").set("x-homectl-user", "user-uuid");

    expect(res.body.role).toBeNull();
  });

  it("gates on the app role", async () => {
    const forbidden = await request(app)
      .get("/admin-only")
      .set("x-homectl-user", "u")
      .set("x-homectl-role", "player");
    expect(forbidden.status).toBe(403);

    const allowed = await request(app)
      .get("/admin-only")
      .set("x-homectl-user", "u")
      .set("x-homectl-role", "admin");
    expect(allowed.status).toBe(200);
  });
});

describe("dev provider", () => {
  const app = appWith(
    createDevProvider({ sub: "dev-user", email: "dev@homectl.no", role: "player" }),
  );

  it("returns the fixed principal", async () => {
    const res = await request(app).get("/who");

    expect(res.body).toEqual({
      sub: "dev-user",
      email: "dev@homectl.no",
      role: "player",
    });
  });

  it("lets a test act as another player via x-dev-sub", async () => {
    const res = await request(app).get("/who").set("x-dev-sub", "second-player");

    expect(res.body.sub).toBe("second-player");
    expect(res.body.email).toBe("second-player@dev.local");
  });
});
