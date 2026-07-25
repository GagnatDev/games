import { describe, expect, it } from "vitest";
import { WINNING_VALUE, canMove, type Tile } from "./engine";
import {
  STATE_VERSION,
  applyMove,
  isCelebrating,
  newGameState,
  parseState,
  type Game2048State,
} from "./state";

/**
 * The save document and the turn it takes. This is the layer the platform stores
 * as opaque jsonb, so the tests care most about two things: a turn is a complete,
 * consistent state, and a document we cannot read is reported rather than reset.
 */
function stateWith(tiles: Tile[], overrides: Partial<Game2048State> = {}): Game2048State {
  return {
    version: STATE_VERSION,
    tiles,
    nextTileId: Math.max(0, ...tiles.map((tile) => tile.id)) + 1,
    score: 0,
    best: 0,
    moves: 0,
    status: "playing",
    reachedTarget: false,
    playingOn: false,
    seed: 7,
    startedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("a new game", () => {
  it("opens with two tiles and a parseable document", () => {
    const state = newGameState(1200);

    expect(state.tiles).toHaveLength(2);
    expect(state.score).toBe(0);
    expect(state.best).toBe(1200);
    expect(state.status).toBe("playing");
    expect(parseState(state)).toEqual(state);
  });
});

describe("a turn", () => {
  it("scores the merge, counts the move and spawns a tile", () => {
    const before = stateWith([
      { id: 1, value: 2, row: 0, col: 0 },
      { id: 2, value: 2, row: 0, col: 1 },
    ]);

    const turn = applyMove(before, "left")!;

    expect(turn.state.score).toBe(4);
    expect(turn.state.best).toBe(4);
    expect(turn.state.moves).toBe(1);
    // Two tiles in, one merged into the other, one spawned.
    expect(turn.state.tiles).toHaveLength(2);
    expect(turn.changes.gained).toBe(4);
    expect(turn.changes.mergedIds).toEqual([1]);
    expect(turn.changes.spawnedId).toBe(before.nextTileId);
    expect(turn.state.nextTileId).toBe(before.nextTileId + 1);
    expect(turn.state.seed).not.toBe(before.seed);
  });

  it("refuses a blocked direction instead of spawning a free tile", () => {
    const before = stateWith([
      { id: 1, value: 4, row: 0, col: 0 },
      { id: 2, value: 2, row: 0, col: 1 },
    ]);

    expect(applyMove(before, "left")).toBeNull();
  });

  it("keeps the best score when the run's score is lower", () => {
    const before = stateWith(
      [
        { id: 1, value: 2, row: 0, col: 0 },
        { id: 2, value: 2, row: 0, col: 1 },
      ],
      { best: 9000 },
    );

    expect(applyMove(before, "left")!.state.best).toBe(9000);
  });

  it("ends the run when the spawned tile locks the board", () => {
    // Full board, exactly one merge available: `2 2` in the top row. Whatever the
    // spawn drops into the freed corner — a 2 or a 4 — it touches an 8 and a 16,
    // so the board is locked either way and the test does not lean on the seed.
    const before = stateWith(
      [
        [2, 2, 8, 16],
        [8, 16, 32, 8],
        [16, 32, 64, 16],
        [32, 64, 128, 32],
      ].flatMap((values, row) =>
        values.map((value, col) => ({ id: row * 4 + col + 1, value, row, col })),
      ),
    );

    const turn = applyMove(before, "left")!;

    expect(turn.state.score).toBe(4);
    expect(turn.state.tiles).toHaveLength(16);
    expect(canMove(turn.state.tiles)).toBe(false);
    expect(turn.state.status).toBe("over");
    // A finished run takes no more turns.
    expect(applyMove(turn.state, "down")).toBeNull();
  });

  it("marks the target as reached and keeps it marked", () => {
    const before = stateWith([
      { id: 1, value: WINNING_VALUE / 2, row: 0, col: 0 },
      { id: 2, value: WINNING_VALUE / 2, row: 0, col: 1 },
    ]);

    const won = applyMove(before, "left")!.state;
    expect(won.reachedTarget).toBe(true);
    expect(isCelebrating(won)).toBe(true);

    // Dismissing the overlay keeps the achievement but stops the interruption.
    expect(isCelebrating({ ...won, playingOn: true })).toBe(false);
    // And a later move does not un-reach it.
    const next = applyMove({ ...won, playingOn: true }, "right");
    expect(next?.state.reachedTarget).toBe(true);
  });
});

describe("parsing a stored document", () => {
  it("accepts what it wrote", () => {
    const state = newGameState();
    expect(parseState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it("reports anything it cannot read instead of resetting it", () => {
    expect(parseState(null)).toBeNull();
    expect(parseState({})).toBeNull();
    // A future version — the whole point of the check.
    expect(parseState({ ...newGameState(), version: STATE_VERSION + 1 })).toBeNull();
    // Off-board tiles, and fields this build does not know about.
    expect(
      parseState({ ...newGameState(), tiles: [{ id: 1, value: 2, row: 9, col: 0 }] }),
    ).toBeNull();
    expect(parseState({ ...newGameState(), cheat: true })).toBeNull();
  });
});
