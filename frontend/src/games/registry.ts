import { lazy, type LazyExoticComponent, type ComponentType } from "react";
// Values come from the `catalogue` subpath, types from the root: importing the
// package root for values would pull the Zod API schemas into the shell chunk.
import { GAMES, LANDFALL_ID } from "@games/shared/catalogue";
import type { GameDefinition } from "@games/shared";

/**
 * Where a game id becomes code.
 *
 * The `import()` calls below are the whole code-splitting story: Vite emits one
 * chunk per `src/games/<id>/` directory (see `manualChunks` in vite.config.ts),
 * so the shell downloads only itself plus the shared vendor chunk, and a game's
 * code arrives when — and only when — someone opens it.
 *
 * Keep these imports lazy and keep the paths literal. A static import here, or a
 * fully dynamic `import(`./games/${id}`)`, collapses the split;
 * `scripts/check-chunks.mjs` fails the build if that happens.
 */
export type GameComponent = LazyExoticComponent<ComponentType>;

const loaders: Record<string, GameComponent> = {
  [LANDFALL_ID]: lazy(() => import("./landfall/index")),
};

export type RegisteredGame = GameDefinition & { component: GameComponent };

export function registeredGames(): RegisteredGame[] {
  return GAMES.flatMap((game) => {
    const component = loaders[game.id];
    return component ? [{ ...game, component }] : [];
  });
}

export function loadGame(id: string): RegisteredGame | undefined {
  return registeredGames().find((game) => game.id === id);
}
