import { z } from "zod";
import {
  SIZE,
  WINNING_VALUE,
  canMove,
  highestTile,
  move,
  openingBoard,
  randomSeed,
  spawnTile,
  type Direction,
  type Tile,
} from "./engine";

/**
 * 2048's save document.
 *
 * The platform stores `state` as opaque jsonb — this file is the only thing that
 * knows what is inside it, and the only place a save migration would live. A
 * document that does not parse is reported, never silently reset.
 *
 * The whole run is in here, seed included, so a save picked up on another device
 * continues the same board rather than a similar one.
 */

export const STATE_VERSION = 1;

const coordinate = z.number().int().min(0).max(SIZE - 1);

const tileSchema = z
  .object({
    id: z.number().int().nonnegative(),
    value: z.number().int().positive(),
    row: coordinate,
    col: coordinate,
  })
  .strict();

export const game2048StateSchema = z
  .object({
    version: z.literal(STATE_VERSION),
    tiles: z.array(tileSchema).max(SIZE * SIZE),
    /** Monotonic id source; keeps tile identity unique for the whole run. */
    nextTileId: z.number().int().positive(),
    score: z.number().int().nonnegative(),
    /** Best score this save has seen; `progress.stats` holds the lifetime one. */
    best: z.number().int().nonnegative(),
    moves: z.number().int().nonnegative(),
    /** `over` means no direction changes the board any more. */
    status: z.enum(["playing", "over"]),
    /** Sticky: once 2048 has been made, it stays made for this run. */
    reachedTarget: z.boolean(),
    /** Whether the player has dismissed the win overlay and played on. */
    playingOn: z.boolean(),
    seed: z.number().int().nonnegative(),
    startedAt: z.string(),
  })
  .strict();

export type Game2048State = z.infer<typeof game2048StateSchema>;

/** What changed in the last move, for the animation. Never persisted. */
export type MoveChanges = {
  readonly mergedIds: readonly number[];
  readonly consumed: readonly Tile[];
  readonly spawnedId: number | null;
  readonly gained: number;
};

export const NO_CHANGES: MoveChanges = {
  mergedIds: [],
  consumed: [],
  spawnedId: null,
  gained: 0,
};

export function newGameState(best = 0, startedAt = new Date().toISOString()): Game2048State {
  const opening = openingBoard(randomSeed());
  return {
    version: STATE_VERSION,
    tiles: [...opening.tiles],
    nextTileId: opening.nextTileId,
    score: 0,
    best,
    moves: 0,
    status: "playing",
    reachedTarget: false,
    playingOn: false,
    seed: opening.seed,
    startedAt,
  };
}

/**
 * One turn: slide, merge, spawn, then decide whether the run is over.
 *
 * Returns `null` when the direction is blocked, so the caller can tell "nothing
 * happened" from "the board changed" without diffing tiles.
 */
export function applyMove(
  state: Game2048State,
  direction: Direction,
): { state: Game2048State; changes: MoveChanges } | null {
  if (state.status === "over") return null;

  const result = move(state.tiles, direction);
  if (!result.moved) return null;

  const spawn = spawnTile(result.tiles, state.nextTileId, state.seed);
  const score = state.score + result.gained;
  const tiles = [...spawn.tiles];

  return {
    state: {
      ...state,
      tiles,
      nextTileId: spawn.nextTileId,
      seed: spawn.seed,
      score,
      best: Math.max(state.best, score),
      moves: state.moves + 1,
      status: canMove(tiles) ? "playing" : "over",
      reachedTarget: state.reachedTarget || highestTile(tiles) >= WINNING_VALUE,
    },
    changes: {
      mergedIds: result.mergedIds,
      consumed: result.consumed,
      spawnedId: spawn.tile?.id ?? null,
      gained: result.gained,
    },
  };
}

/** True while the win overlay should be showing. */
export function isCelebrating(state: Game2048State): boolean {
  return state.reachedTarget && !state.playingOn && state.status !== "over";
}

/** Unknown or future saves are reported, never silently reset. */
export function parseState(raw: unknown): Game2048State | null {
  const result = game2048StateSchema.safeParse(raw);
  return result.success ? result.data : null;
}
