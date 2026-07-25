/**
 * 2048's board rules, as pure functions.
 *
 * Nothing here knows about React, the API or the save document: a board is a flat
 * list of tiles with stable ids, and every transition returns a new list. That is
 * what makes the game testable (`engine.test.ts`) and what lets the UI animate —
 * a tile keeps its id while it slides, so the DOM node keeps its identity too.
 *
 * Randomness is explicit for the same reason. The seed travels through the save
 * document instead of living in `Math.random()`, so a run is reproducible and the
 * tests do not have to stub globals.
 */

export const SIZE = 4;
export const WINNING_VALUE = 2048;

/** Chance that a freshly spawned tile is a 4 rather than a 2. */
const FOUR_CHANCE = 0.1;

export type Direction = "up" | "down" | "left" | "right";

export type Tile = {
  /** Stable across slides and merges — the UI keys DOM nodes off it. */
  readonly id: number;
  readonly value: number;
  readonly row: number;
  readonly col: number;
};

export type MoveResult = {
  /** The board after the move: survivors only, with updated positions. */
  readonly tiles: readonly Tile[];
  /**
   * Tiles that merged *into* another one. They carry their destination position,
   * so the UI can slide them there before dropping them.
   */
  readonly consumed: readonly Tile[];
  /** Ids of the tiles that grew, for the merge animation. */
  readonly mergedIds: readonly number[];
  readonly gained: number;
  /** False when the direction is blocked; the caller must not spawn a tile. */
  readonly moved: boolean;
};

// ── Randomness ──────────────────────────────────────────────────────────────

export type Roll = { readonly value: number; readonly seed: number };

/**
 * mulberry32, written as a pure step: same seed in, same number and next seed
 * out. Good enough for tile placement and small enough to keep in the chunk.
 */
export function nextRandom(seed: number): Roll {
  const next = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(next ^ (next >>> 15), 1 | next);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, seed: next >>> 0 };
}

/** A seed for a fresh run. The only place the game touches ambient randomness. */
export function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

// ── Queries ─────────────────────────────────────────────────────────────────

export function tileAt(
  tiles: readonly Tile[],
  row: number,
  col: number,
): Tile | undefined {
  return tiles.find((tile) => tile.row === row && tile.col === col);
}

export function emptyCells(tiles: readonly Tile[]): Array<{ row: number; col: number }> {
  const cells: Array<{ row: number; col: number }> = [];
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      if (!tileAt(tiles, row, col)) cells.push({ row, col });
    }
  }
  return cells;
}

export function highestTile(tiles: readonly Tile[]): number {
  return tiles.reduce((best, tile) => Math.max(best, tile.value), 0);
}

/** True while any direction would still change the board. */
export function canMove(tiles: readonly Tile[]): boolean {
  if (tiles.length < SIZE * SIZE) return true;
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const tile = tileAt(tiles, row, col);
      if (!tile) return true;
      const right = tileAt(tiles, row, col + 1);
      const down = tileAt(tiles, row + 1, col);
      if (right?.value === tile.value || down?.value === tile.value) return true;
    }
  }
  return false;
}

// ── Transitions ─────────────────────────────────────────────────────────────

/**
 * Slide and merge in one direction.
 *
 * Each line is walked from the wall the tiles travel towards, so the tile nearest
 * that wall survives a merge and the incoming one is consumed. A tile that has
 * just merged cannot merge again this move — that is what makes `2 2 2` become
 * `4 2` and not `8`.
 */
export function move(tiles: readonly Tile[], direction: Direction): MoveResult {
  const survivors: Tile[] = [];
  const consumed: Tile[] = [];
  const mergedIds: number[] = [];
  let gained = 0;
  let moved = false;

  for (const line of lines(direction)) {
    // Tiles in travel order: the first one ends up against the wall.
    const travelling = line.flatMap((cell) => {
      const tile = tileAt(tiles, cell.row, cell.col);
      return tile ? [tile] : [];
    });

    let cursor = 0;
    let last: Tile | undefined;
    let lastMerged = false;

    for (const tile of travelling) {
      if (last && !lastMerged && last.value === tile.value) {
        const grown: Tile = { ...last, value: last.value * 2 };
        survivors[survivors.length - 1] = grown;
        consumed.push({ ...tile, row: grown.row, col: grown.col });
        mergedIds.push(grown.id);
        gained += grown.value;
        last = grown;
        lastMerged = true;
        moved = true;
        continue;
      }

      const target = line[cursor]!;
      cursor += 1;
      const placed: Tile = { ...tile, row: target.row, col: target.col };
      if (placed.row !== tile.row || placed.col !== tile.col) moved = true;
      survivors.push(placed);
      last = placed;
      lastMerged = false;
    }
  }

  return moved
    ? { tiles: survivors, consumed, mergedIds, gained, moved: true }
    : { tiles, consumed: [], mergedIds: [], gained: 0, moved: false };
}

export type Spawn = {
  readonly tiles: readonly Tile[];
  readonly tile: Tile | null;
  readonly nextTileId: number;
  readonly seed: number;
};

/** Drop a 2 (or, one time in ten, a 4) into a random empty cell. */
export function spawnTile(
  tiles: readonly Tile[],
  nextTileId: number,
  seed: number,
): Spawn {
  const cells = emptyCells(tiles);
  if (cells.length === 0) return { tiles, tile: null, nextTileId, seed };

  const pick = nextRandom(seed);
  const cell = cells[Math.floor(pick.value * cells.length)]!;
  const kind = nextRandom(pick.seed);
  const tile: Tile = {
    id: nextTileId,
    value: kind.value < FOUR_CHANCE ? 4 : 2,
    row: cell.row,
    col: cell.col,
  };

  return {
    tiles: [...tiles, tile],
    tile,
    nextTileId: nextTileId + 1,
    seed: kind.seed,
  };
}

/** The two tiles a run opens with. */
export function openingBoard(seed: number): Spawn {
  const first = spawnTile([], 1, seed);
  return spawnTile(first.tiles, first.nextTileId, first.seed);
}

/**
 * Cell coordinates per line, ordered from the wall the tiles travel towards.
 * `lines("left")[r][0]` is therefore the leftmost cell of row `r`.
 */
function lines(direction: Direction): Array<Array<{ row: number; col: number }>> {
  const indexes = [...Array(SIZE).keys()];
  const forward = direction === "left" || direction === "up";
  const along = forward ? indexes : [...indexes].reverse();

  return indexes.map((line) =>
    along.map((step) =>
      direction === "left" || direction === "right"
        ? { row: line, col: step }
        : { row: step, col: line },
    ),
  );
}
