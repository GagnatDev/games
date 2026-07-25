import { describe, expect, it } from "vitest";
import {
  SIZE,
  canMove,
  emptyCells,
  highestTile,
  move,
  nextRandom,
  openingBoard,
  spawnTile,
  tileAt,
  type Direction,
  type Tile,
} from "./engine";

/**
 * The rules, tested as arithmetic rather than through the DOM. Every board below
 * is written as a grid of values (0 = empty) so the expectations read like the
 * screen does.
 */
function board(rows: number[][]): Tile[] {
  const tiles: Tile[] = [];
  let id = 1;
  rows.forEach((cells, row) =>
    cells.forEach((value, col) => {
      if (value > 0) tiles.push({ id: id++, value, row, col });
    }),
  );
  return tiles;
}

function grid(tiles: readonly Tile[]): number[][] {
  return Array.from({ length: SIZE }, (_, row) =>
    Array.from({ length: SIZE }, (_, col) => tileAt(tiles, row, col)?.value ?? 0),
  );
}

function slide(rows: number[][], direction: Direction) {
  const result = move(board(rows), direction);
  return { ...result, grid: grid(result.tiles) };
}

describe("sliding", () => {
  it("packs tiles against the wall without merging unequal values", () => {
    const { grid: after, gained, moved } = slide(
      [
        [0, 2, 0, 4],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      "left",
    );

    expect(after[0]).toEqual([2, 4, 0, 0]);
    expect(gained).toBe(0);
    expect(moved).toBe(true);
  });

  it("merges a pair and scores the tile it becomes", () => {
    const { grid: after, gained, mergedIds, consumed } = slide(
      [
        [2, 2, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      "left",
    );

    expect(after[0]).toEqual([4, 0, 0, 0]);
    expect(gained).toBe(4);
    expect(mergedIds).toHaveLength(1);
    // The consumed tile carries its destination, so the UI can slide it there.
    expect(consumed).toEqual([{ id: 2, value: 2, row: 0, col: 0 }]);
  });

  it("spends a merged tile for the rest of the move", () => {
    // 2 2 2 must become 4 2, never 8.
    expect(
      slide(
        [
          [2, 2, 2, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ],
        "left",
      ).grid[0],
    ).toEqual([4, 2, 0, 0]);

    const four = slide(
      [
        [2, 2, 2, 2],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ],
      "left",
    );
    expect(four.grid[0]).toEqual([4, 4, 0, 0]);
    expect(four.gained).toBe(8);
  });

  it("merges the pair nearest the wall the tiles travel towards", () => {
    expect(
      slide(
        [
          [4, 2, 2, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ],
        "left",
      ).grid[0],
    ).toEqual([4, 4, 0, 0]);

    expect(
      slide(
        [
          [0, 2, 2, 4],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
          [0, 0, 0, 0],
        ],
        "right",
      ).grid[0],
    ).toEqual([0, 0, 4, 4]);
  });

  it("slides in every direction", () => {
    const rows = [
      [2, 0, 0, 0],
      [2, 0, 0, 0],
      [0, 0, 0, 8],
      [0, 0, 0, 0],
    ];

    expect(grid(move(board(rows), "up").tiles)).toEqual([
      [4, 0, 0, 8],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
    expect(grid(move(board(rows), "down").tiles)).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [4, 0, 0, 8],
    ]);
    expect(grid(move(board(rows), "right").tiles)).toEqual([
      [0, 0, 0, 2],
      [0, 0, 0, 2],
      [0, 0, 0, 8],
      [0, 0, 0, 0],
    ]);
  });

  it("keeps tile identity across a slide, so the UI can animate it", () => {
    const tiles = board([
      [0, 0, 0, 2],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);

    const result = move(tiles, "left");
    expect(result.tiles).toEqual([{ id: 1, value: 2, row: 0, col: 0 }]);
  });

  it("reports a blocked direction and leaves the board alone", () => {
    const rows = [
      [4, 2, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ];
    const tiles = board(rows);
    const result = move(tiles, "left");

    expect(result.moved).toBe(false);
    expect(result.tiles).toBe(tiles);
    expect(result.gained).toBe(0);
  });

  it("counts a merge as a move even when nothing changes column", () => {
    const result = move(
      board([
        [2, 2, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
        [0, 0, 0, 0],
      ]),
      "left",
    );

    expect(result.moved).toBe(true);
  });
});

describe("board queries", () => {
  it("finds the empty cells and the highest tile", () => {
    const tiles = board([
      [2, 4, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 64],
      [0, 0, 0, 0],
    ]);

    expect(emptyCells(tiles)).toHaveLength(SIZE * SIZE - 3);
    expect(highestTile(tiles)).toBe(64);
  });

  it("is playable while a direction would change something", () => {
    expect(
      canMove(
        board([
          [2, 4, 2, 4],
          [4, 2, 4, 2],
          [2, 4, 2, 4],
          [4, 2, 4, 0],
        ]),
      ),
    ).toBe(true);

    // Full, no neighbours equal: locked.
    expect(
      canMove(
        board([
          [2, 4, 2, 4],
          [4, 2, 4, 2],
          [2, 4, 2, 4],
          [4, 2, 4, 2],
        ]),
      ),
    ).toBe(false);

    // Full, but two equal neighbours: still playable.
    expect(
      canMove(
        board([
          [2, 2, 4, 8],
          [4, 8, 16, 32],
          [2, 4, 8, 16],
          [4, 8, 16, 32],
        ]),
      ),
    ).toBe(true);
  });
});

describe("randomness", () => {
  it("is a pure step: the same seed gives the same roll", () => {
    const first = nextRandom(12345);
    expect(nextRandom(12345)).toEqual(first);
    expect(first.value).toBeGreaterThanOrEqual(0);
    expect(first.value).toBeLessThan(1);
    expect(first.seed).not.toBe(12345);
  });

  it("spawns a 2 or a 4 into an empty cell and advances the seed", () => {
    const tiles = board([
      [2, 4, 8, 16],
      [4, 8, 16, 32],
      [8, 16, 32, 64],
      [16, 32, 64, 0],
    ]);

    const spawn = spawnTile(tiles, 99, 7);
    expect(spawn.tile).toMatchObject({ id: 99, row: 3, col: 3 });
    expect([2, 4]).toContain(spawn.tile?.value);
    expect(spawn.nextTileId).toBe(100);
    expect(spawn.seed).not.toBe(7);
  });

  it("spawns nothing on a full board", () => {
    const tiles = board([
      [2, 4, 8, 16],
      [4, 8, 16, 32],
      [8, 16, 32, 64],
      [16, 32, 64, 128],
    ]);

    const spawn = spawnTile(tiles, 99, 7);
    expect(spawn.tile).toBeNull();
    expect(spawn.tiles).toBe(tiles);
    expect(spawn.nextTileId).toBe(99);
  });

  it("reproduces a whole run from its seed", () => {
    const runFrom = (seed: number) => {
      let run = openingBoard(seed);
      const directions: Direction[] = ["left", "up", "right", "down"];
      for (const direction of directions) {
        const result = move(run.tiles, direction);
        if (!result.moved) continue;
        run = spawnTile(result.tiles, run.nextTileId, run.seed);
      }
      return grid(run.tiles);
    };

    expect(runFrom(4242)).toEqual(runFrom(4242));
  });

  it("opens with two tiles", () => {
    const opening = openingBoard(1);
    expect(opening.tiles).toHaveLength(2);
    expect(opening.nextTileId).toBe(3);
    expect(new Set(opening.tiles.map((tile) => `${tile.row}:${tile.col}`)).size).toBe(2);
  });
});
