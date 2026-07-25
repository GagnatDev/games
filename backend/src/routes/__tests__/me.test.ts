import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool } from "../../db/pool.js";
import { api, asPlayer, resetDb } from "../../test/helpers.js";

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closePool();
});

describe("player profile", () => {
  it("provisions a row just in time, once per auth subject", async () => {
    const first = await api().get("/api/me").set(asPlayer("skipper"));
    const second = await api().get("/api/me").set(asPlayer("skipper"));

    expect(first.status).toBe(200);
    expect(first.body.id).toBe(second.body.id);
    expect(first.body).toMatchObject({
      email: "skipper@dev.local",
      displayName: "skipper",
      role: "player",
      profile: {},
    });
  });

  it("stores a free-form profile document", async () => {
    const profile = {
      theme: "dark",
      reduceMotion: true,
      notify: { landfall: ["voyage-complete"] },
    };

    const res = await api()
      .patch("/api/me")
      .send({ displayName: "Skipper Ann", profile });

    expect(res.status).toBe(200);
    expect(res.body.displayName).toBe("Skipper Ann");
    expect(res.body.profile).toEqual(profile);

    const reread = await api().get("/api/me");
    expect(reread.body.profile).toEqual(profile);
  });

  it("does not let the auth service overwrite a chosen display name", async () => {
    await api().patch("/api/me").send({ displayName: "Skipper Ann" });

    const reread = await api().get("/api/me");
    expect(reread.body.displayName).toBe("Skipper Ann");
  });

  it("rejects unknown fields", async () => {
    const res = await api().patch("/api/me").send({ isAdmin: true });

    expect(res.status).toBe(400);
  });

  it("answers the session probe", async () => {
    const res = await api().get("/api/session");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ authenticated: true, role: "player" });
  });
});

describe("push", () => {
  it("reports no public key when the deployment has no VAPID secret", async () => {
    const res = await api().get("/api/push/config");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ publicKey: null });
  });

  it("refuses a test push when push is disabled", async () => {
    const res = await api().post("/api/push/test").send({});

    expect(res.status).toBe(503);
    expect(res.body.error).toBe("push_disabled");
  });

  it("stores and removes a subscription", async () => {
    const subscription = {
      endpoint: "https://push.example/abc",
      keys: { p256dh: "key", auth: "secret" },
      topics: { landfall: true },
    };

    expect(
      (await api().post("/api/push/subscriptions").send(subscription)).status,
    ).toBe(201);
    // Re-subscribing the same endpoint updates rather than duplicates.
    expect(
      (await api().post("/api/push/subscriptions").send(subscription)).status,
    ).toBe(201);

    const removed = await api()
      .delete("/api/push/subscriptions")
      .send({ endpoint: subscription.endpoint });
    expect(removed.status).toBe(204);
  });

  it("rejects a malformed subscription", async () => {
    const res = await api()
      .post("/api/push/subscriptions")
      .send({ endpoint: "not-a-url", keys: {} });

    expect(res.status).toBe(400);
  });
});
