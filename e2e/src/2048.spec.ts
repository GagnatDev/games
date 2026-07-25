import type { Page } from "@playwright/test";
// The fixtures wrapper truncates player data before each test.
import { expect, test } from "./fixtures";

/**
 * 2048 through the browser: the rules are unit-tested in the frontend package, so
 * what matters here is the part only a real stack can prove — input reaches the
 * board, the run survives a reload because it is in Postgres, and finishing a run
 * reaches the leaderboard.
 *
 * Boards are random, so anything that needs a specific position seeds one through
 * the platform's own save API rather than reaching into the database.
 */

/**
 * Every tile as `row:col=value`, sorted. Takes the expected count so it waits for
 * the board to render instead of reading an empty DOM.
 */
async function boardValues(page: Page, expected: number): Promise<string[]> {
  const tiles = page.locator(".g2048-tile:not(.g2048-tile--ghost)");
  await expect(tiles).toHaveCount(expected);

  return await tiles.evaluateAll((tiles) =>
    tiles
      .map((tile) => {
        const style = tile.getAttribute("style") ?? "";
        return `${/--row:\s*(\d)/.exec(style)?.[1]}:${/--col:\s*(\d)/.exec(style)?.[1]}=${
          tile.textContent
        }`;
      })
      .sort(),
  );
}

/**
 * Replace the stored board with a known one, through `PUT /saves/default` — the
 * same call the game itself makes, `expectedRevision` included.
 */
async function seedBoard(
  page: Page,
  rows: number[][],
  overrides: Record<string, unknown> = {},
): Promise<void> {
  // Wait for the game's own first write, so this one is not racing it.
  await expect(page.getByTestId("save-status")).toContainText("Saved");

  const failure = await page.evaluate(
    async ([grid, extra]) => {
      const tiles = (grid as number[][]).flatMap((values, row) =>
        values.flatMap((value, col) =>
          value > 0 ? [{ id: row * 4 + col + 1, value, row, col }] : [],
        ),
      );
      const current = await fetch("/api/games/2048/saves/default", {
        headers: { Accept: "application/json" },
      }).then((response) => response.json());

      const response = await fetch("/api/games/2048/saves/default", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: {
            version: 1,
            tiles,
            nextTileId: 100,
            score: 0,
            best: 0,
            moves: 12,
            status: "playing",
            reachedTarget: false,
            playingOn: false,
            seed: 42,
            startedAt: "2026-01-01T00:00:00.000Z",
            ...(extra as Record<string, unknown>),
          },
          stateVersion: 1,
          expectedRevision: current.revision,
        }),
      });
      return response.ok ? null : `${response.status} ${await response.text()}`;
    },
    [rows, overrides] as const,
  );

  expect(failure).toBeNull();
  await page.reload();

  // The board only takes input once the save has been read back, so wait for the
  // seeded tiles to be on screen before the test presses anything.
  const tiles = rows.flat().filter((value) => value > 0).length;
  await expect(page.locator(".g2048-tile")).toHaveCount(tiles);
  await expect(page.getByTestId("save-status")).toContainText("revision 2");
}

test("the hub lists 2048 and the deep link is served by the backend", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: /2048/ })).toBeVisible();

  // A fresh top-level navigation, not a client-side route change.
  const response = await page.goto("/2048");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "2048", level: 1 })).toBeVisible();

  // A new player gets an opening board, already persisted.
  await expect(page.locator(".g2048-tile")).toHaveCount(2);
  await expect(page.getByTestId("save-status")).toContainText("revision 1");
});

test("the arrow keys move the tiles and the board survives a reload", async ({ page }) => {
  await page.goto("/2048");
  await seedBoard(page, [
    [2, 2, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [4, 0, 0, 4],
  ]);

  await expect(page.getByTestId("score")).toHaveText("0");

  await page.keyboard.press("ArrowLeft");

  // 2+2 and 4+4 both merge, and one new tile drops in.
  await expect(page.getByTestId("score")).toHaveText("12");
  await expect(page.getByTestId("best")).toHaveText("12");
  await expect(page.locator(".g2048-tile:not(.g2048-tile--ghost)")).toHaveCount(3);

  const afterMove = await boardValues(page, 3);
  await expect(page.getByTestId("save-status")).toContainText("revision 3");

  await page.reload();

  await expect(page.getByTestId("score")).toHaveText("12");
  expect(await boardValues(page, 3)).toEqual(afterMove);
});

test("undo takes back the last move, and a new game starts over", async ({ page }) => {
  await page.goto("/2048");
  await seedBoard(page, [
    [8, 8, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);

  const opening = await boardValues(page, 2);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  await page.keyboard.press("ArrowLeft");
  await expect(page.getByTestId("score")).toHaveText("16");
  // Wait for the move's own write, so the undo below is a second one.
  await expect(page.getByTestId("save-status")).toContainText("revision 3");

  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByTestId("score")).toHaveText("0");
  expect(await boardValues(page, 2)).toEqual(opening);

  // The undo is a write of its own, so the rewound board survives a reload.
  await expect(page.getByTestId("save-status")).toContainText("revision 4");
  await page.reload();
  expect(await boardValues(page, 2)).toEqual(opening);
  await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();

  await page.getByRole("button", { name: "New game" }).click();
  await expect(page.locator(".g2048-tile")).toHaveCount(2);
  await expect(page.getByTestId("score")).toHaveText("0");
});

test("reaching 2048 offers to keep playing", async ({ page }) => {
  await page.goto("/2048");
  await seedBoard(page, [
    [1024, 1024, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);

  await page.keyboard.press("ArrowLeft");

  await expect(page.getByText("2048!")).toBeVisible();
  await expect(page.getByTestId("save-status")).toContainText("revision 3");

  await page.getByRole("button", { name: "Keep going" }).click();
  await expect(page.getByText("2048!")).toBeHidden();
  await expect(page.getByTestId("score")).toHaveText("2048");

  // Playing on is part of the run, so the overlay stays dismissed after a reload.
  await expect(page.getByTestId("save-status")).toContainText("revision 4");
  await page.reload();
  await expect(page.getByTestId("score")).toHaveText("2048");
  await expect(page.getByRole("button", { name: "Keep going" })).toBeHidden();
});

test("a finished run ends the board and lands on the leaderboard", async ({ page }) => {
  await page.goto("/2048");
  // Full board, one merge left: whatever spawns in the freed corner touches an 8
  // and a 16, so the run is over however the tile falls.
  await seedBoard(page, [
    [2, 2, 8, 16],
    [8, 16, 32, 8],
    [16, 32, 64, 16],
    [32, 64, 128, 32],
  ]);

  await page.keyboard.press("ArrowLeft");

  await expect(page.getByText("No moves left")).toBeVisible();
  await expect(page.getByText("Final score 4 after 13 moves.")).toBeVisible();

  // The score is posted to the platform's leaderboard, with the run's best tile.
  const entries = page.getByTestId("high-scores").getByRole("listitem");
  await expect(entries).toHaveCount(1);
  await expect(entries.locator(".g2048-scoreboard__value")).toHaveText("4");
  await expect(entries).toContainText("tile 128");

  // Lifetime stats are progression, not save state: they survive the next run.
  const progress = await page.evaluate(async () => {
    const response = await fetch("/api/games/2048/progress", {
      headers: { Accept: "application/json" },
    });
    return (await response.json()) as { stats: Record<string, number> };
  });
  expect(progress.stats).toMatchObject({ runs: 1, bestScore: 4, bestTile: 128 });

  // Two "New game" buttons while the overlay is up — take the one on the overlay.
  await page.locator(".g2048-overlay").getByRole("button", { name: "New game" }).click();
  await expect(page.getByText("No moves left")).toBeHidden();
  await expect(page.locator(".g2048-tile")).toHaveCount(2);
});

test("a save from a newer build is reported, not overwritten", async ({ page }) => {
  await page.goto("/2048");
  await expect(page.getByTestId("save-status")).toContainText("Saved");

  const failure = await page.evaluate(async () => {
    const current = await fetch("/api/games/2048/saves/default", {
      headers: { Accept: "application/json" },
    }).then((response) => response.json());

    const response = await fetch("/api/games/2048/saves/default", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: { version: 2, board: "something this build has never seen" },
        stateVersion: 2,
        expectedRevision: current.revision,
      }),
    });
    return response.ok ? null : `${response.status} ${await response.text()}`;
  });
  expect(failure).toBeNull();

  await page.reload();

  await expect(page.getByText(/written by a different version/)).toBeVisible();
  // Still there, untouched, until the player asks for a new game.
  const stored = await page.evaluate(async () => {
    const response = await fetch("/api/games/2048/saves/default", {
      headers: { Accept: "application/json" },
    });
    return (await response.json()) as { stateVersion: number };
  });
  expect(stored.stateVersion).toBe(2);
});
