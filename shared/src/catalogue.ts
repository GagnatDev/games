/**
 * The game catalogue — the single source of truth for what lives at
 * `https://games.homectl.no/<id>`.
 *
 * This is deliberately *metadata only*: no game logic, no React, no server code,
 * so both bundles can import it without pulling a game in. The frontend maps
 * each id to a lazily imported chunk (`frontend/src/games/registry.ts`) and the
 * backend upserts these rows into the `games` table at boot
 * (`backend/src/games/sync.ts`).
 *
 * Adding a game = add an entry here + a chunk in the frontend registry. See
 * `docs/adding-a-game.md`.
 */

export type GameStatus = "shell" | "alpha" | "beta" | "live";

export type GameDefinition = {
  /** URL slug and primary key. kebab-case, stable forever — saves key off it. */
  readonly id: string;
  readonly title: string;
  readonly tagline: string;
  readonly status: GameStatus;
  /**
   * Version of *this game's own* `state` jsonb shape. The platform never reads
   * the state; the game bumps this when it needs to migrate its own saves.
   */
  readonly stateVersion: number;
  /** Static, game-owned config. Mirrored into the `games.config` jsonb column. */
  readonly config: Readonly<Record<string, unknown>>;
};

export const LANDFALL_ID = "landfall";
export const GAME_2048_ID = "2048";

export const GAMES: readonly GameDefinition[] = [
  {
    id: GAME_2048_ID,
    title: "2048",
    tagline: "Slide the tiles, merge the pairs, and keep the board alive to 2048.",
    status: "live",
    stateVersion: 1,
    config: {
      size: 4,
      winningTile: 2048,
      /** The leaderboard the game posts a finished run to. */
      scoreBoard: "high-score",
    },
  },
  {
    id: LANDFALL_ID,
    title: "Landfall",
    tagline:
      "Charter a tramp freighter, chase cargo across the world's ports, and try to out-trade the tide.",
    status: "beta",
    // v3: concurrent voyages — several ships may carry freight at once.
    // v2 saves migrate in-game; v1 shell saves are reported, never overwritten.
    stateVersion: 3,
    config: {
      startingCapital: 2_500_000,
      currency: "USD",
      /** The leaderboard a completed voyage posts the company's worth to. */
      scoreBoard: "fortune",
      inspiredBy: "Ports of Call (1986)",
    },
  },
];

const byId = new Map(GAMES.map((game) => [game.id, game]));

export const GAME_IDS: readonly string[] = GAMES.map((game) => game.id);

export function findGame(id: string): GameDefinition | undefined {
  return byId.get(id);
}

export function isGameId(id: string): boolean {
  return byId.has(id);
}
