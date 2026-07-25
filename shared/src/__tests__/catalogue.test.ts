import { describe, expect, it } from "vitest";
import { GAMES, GAME_IDS, findGame, isGameId } from "../catalogue.js";
import { MAX_JSON_BYTES, jsonObject } from "../json.js";
import { saveWriteSchema, slotSchema } from "../api.js";

describe("catalogue", () => {
  it("has unique, url-safe ids", () => {
    expect(new Set(GAME_IDS).size).toBe(GAME_IDS.length);
    for (const id of GAME_IDS) {
      expect(id).toMatch(/^[a-z0-9][a-z0-9-]*$/);
    }
  });

  it("looks games up by id", () => {
    const first = GAMES[0]!;
    expect(findGame(first.id)).toBe(first);
    expect(isGameId(first.id)).toBe(true);
    expect(findGame("no-such-game")).toBeUndefined();
  });
});

describe("json guards", () => {
  it("accepts nested documents", () => {
    const doc = { ship: { name: "Kestrel", holds: [{ cargo: "grain", tons: 4200 }] } };
    expect(jsonObject.parse(doc)).toEqual(doc);
  });

  it("rejects documents over the size ceiling", () => {
    const doc = { blob: "x".repeat(MAX_JSON_BYTES + 1) };
    expect(jsonObject.safeParse(doc).success).toBe(false);
  });
});

describe("save writes", () => {
  it("requires a state version and rejects unknown fields", () => {
    expect(saveWriteSchema.safeParse({ state: {}, stateVersion: 1 }).success).toBe(true);
    expect(saveWriteSchema.safeParse({ state: {} }).success).toBe(false);
    expect(
      saveWriteSchema.safeParse({ state: {}, stateVersion: 1, sneaky: true }).success,
    ).toBe(false);
  });

  it("constrains slot names", () => {
    expect(slotSchema.safeParse("default").success).toBe(true);
    expect(slotSchema.safeParse("slot-2").success).toBe(true);
    expect(slotSchema.safeParse("Slot 2").success).toBe(false);
  });
});
