import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { LANDFALL_ID } from "@games/shared";
import { closePool } from "../../db/pool.js";
import { api, asPlayer, resetDb } from "../../test/helpers.js";

const GAME = `/api/games/${LANDFALL_ID}`;

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await closePool();
});

describe("catalogue", () => {
  it("lists the seeded games with no play history for a new player", async () => {
    const res = await api().get("/api/games");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      expect.objectContaining({
        id: LANDFALL_ID,
        title: "Landfall",
        status: "shell",
        lastPlayedAt: null,
      }),
    ]);
  });

  it("404s an unknown game rather than creating orphan rows", async () => {
    const res = await api().get("/api/games/no-such-game/saves");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("unknown_game");
  });
});

describe("saves", () => {
  it("provisions the player on first request and round-trips arbitrary state", async () => {
    const state = {
      ship: { name: "Kestrel", tons: 12_400 },
      port: "rotterdam",
      ledger: [{ day: 1, cash: 250_000 }],
    };

    const write = await api()
      .put(`${GAME}/saves/default`)
      .send({ state, stateVersion: 1 });

    expect(write.status).toBe(200);
    expect(write.body).toMatchObject({
      gameId: LANDFALL_ID,
      slot: "default",
      state,
      stateVersion: 1,
      revision: 1,
      status: "active",
    });

    const read = await api().get(`${GAME}/saves/default`);
    expect(read.body.state).toEqual(state);
  });

  it("404s a slot that was never written", async () => {
    const res = await api().get(`${GAME}/saves/default`);

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("save_not_found");
  });

  it("bumps the revision on every write", async () => {
    await api().put(`${GAME}/saves/default`).send({ state: {}, stateVersion: 1 });
    const second = await api()
      .put(`${GAME}/saves/default`)
      .send({ state: { turn: 2 }, stateVersion: 1 });

    expect(second.body.revision).toBe(2);
  });

  it("rejects a write that carries a stale revision", async () => {
    const first = await api()
      .put(`${GAME}/saves/default`)
      .send({ state: { turn: 1 }, stateVersion: 1 });
    expect(first.body.revision).toBe(1);

    // Another device writes, moving the row to revision 2.
    await api()
      .put(`${GAME}/saves/default`)
      .send({ state: { turn: 2 }, stateVersion: 1, expectedRevision: 1 });

    // The first device still thinks it holds revision 1.
    const stale = await api()
      .put(`${GAME}/saves/default`)
      .send({ state: { turn: 99 }, stateVersion: 1, expectedRevision: 1 });

    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({
      error: "revision_conflict",
      currentRevision: 2,
    });

    const read = await api().get(`${GAME}/saves/default`);
    expect(read.body.state).toEqual({ turn: 2 });
  });

  it("keeps slots and players separate", async () => {
    await api()
      .put(`${GAME}/saves/default`)
      .set(asPlayer("skipper"))
      .send({ state: { who: "skipper" }, stateVersion: 1 });
    await api()
      .put(`${GAME}/saves/slot-2`)
      .set(asPlayer("skipper"))
      .send({ state: { who: "skipper-2" }, stateVersion: 1 });
    await api()
      .put(`${GAME}/saves/default`)
      .set(asPlayer("mate"))
      .send({ state: { who: "mate" }, stateVersion: 1 });

    const skipperSaves = await api().get(`${GAME}/saves`).set(asPlayer("skipper"));
    expect(skipperSaves.body).toHaveLength(2);

    const mateSaves = await api().get(`${GAME}/saves`).set(asPlayer("mate"));
    expect(mateSaves.body).toHaveLength(1);
    expect(mateSaves.body[0].state).toEqual({ who: "mate" });
  });

  it("keeps the larger played_seconds and deletes on request", async () => {
    await api()
      .put(`${GAME}/saves/default`)
      .send({ state: {}, stateVersion: 1, playedSeconds: 600 });
    const back = await api()
      .put(`${GAME}/saves/default`)
      .send({ state: {}, stateVersion: 1, playedSeconds: 10 });

    expect(back.body.playedSeconds).toBe(600);

    expect((await api().delete(`${GAME}/saves/default`)).status).toBe(204);
    expect((await api().delete(`${GAME}/saves/default`)).status).toBe(404);
  });

  it("rejects malformed writes", async () => {
    const noVersion = await api().put(`${GAME}/saves/default`).send({ state: {} });
    expect(noVersion.status).toBe(400);
    expect(noVersion.body.error).toBe("invalid_request");

    const badSlot = await api()
      .put(`${GAME}/saves/Not A Slot`)
      .send({ state: {}, stateVersion: 1 });
    expect(badSlot.status).toBe(400);
  });
});

describe("progress", () => {
  it("starts empty", async () => {
    const res = await api().get(`${GAME}/progress`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ progression: {}, stats: {} });
  });

  it("shallow-merges on PATCH and replaces on PUT", async () => {
    await api()
      .patch(`${GAME}/progress`)
      .send({ progression: { unlocked: ["panama"] }, stats: { voyages: 1 } });

    const merged = await api()
      .patch(`${GAME}/progress`)
      .send({ progression: { reputation: 3 } });

    expect(merged.body.progression).toEqual({ unlocked: ["panama"], reputation: 3 });
    expect(merged.body.stats).toEqual({ voyages: 1 });

    const replaced = await api()
      .put(`${GAME}/progress`)
      .send({ progression: { reputation: 9 } });

    expect(replaced.body.progression).toEqual({ reputation: 9 });
  });

  it("requires at least one document", async () => {
    const res = await api().patch(`${GAME}/progress`).send({});

    expect(res.status).toBe(400);
  });

  it("records last_played_at when a save is written", async () => {
    await api().put(`${GAME}/saves/default`).send({ state: {}, stateVersion: 1 });

    const list = await api().get("/api/games");
    expect(list.body[0].lastPlayedAt).not.toBeNull();
  });
});

describe("events", () => {
  it("appends a batch and reads it back newest first", async () => {
    const res = await api()
      .post(`${GAME}/events`)
      .send({
        events: [
          { kind: "voyage.started", payload: { from: "oslo" } },
          { kind: "voyage.completed", payload: { profit: 42_000 } },
        ],
      });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ appended: 2 });

    const list = await api().get(`${GAME}/events?limit=10`);
    expect(list.body).toHaveLength(2);
    expect(list.body.map((e: { kind: string }) => e.kind)).toContain("voyage.completed");
  });

  it("rejects an empty batch", async () => {
    const res = await api().post(`${GAME}/events`).send({ events: [] });

    expect(res.status).toBe(400);
  });
});

describe("scores", () => {
  it("ranks the best run per player", async () => {
    await api()
      .post(`${GAME}/scores`)
      .set(asPlayer("skipper"))
      .send({ score: 1_000, details: { ship: "Kestrel" } });
    await api().post(`${GAME}/scores`).set(asPlayer("skipper")).send({ score: 4_000 });
    await api().post(`${GAME}/scores`).set(asPlayer("mate")).send({ score: 2_500 });

    const board = await api().get(`${GAME}/scores`);

    expect(board.status).toBe(200);
    expect(board.body).toHaveLength(2);
    expect(board.body[0]).toMatchObject({ rank: 1, score: 4_000 });
    expect(board.body[1]).toMatchObject({ rank: 2, score: 2_500 });
  });

  it("keeps separate boards", async () => {
    await api().post(`${GAME}/scores`).send({ score: 10, board: "weekly-run" });

    expect((await api().get(`${GAME}/scores`)).body).toHaveLength(0);
    expect((await api().get(`${GAME}/scores?board=weekly-run`)).body).toHaveLength(1);
  });
});
