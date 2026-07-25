import { GAMES } from "@games/shared";
import { db } from "../db/kysely.js";
import { toJson } from "../db/schema.js";
import { logger } from "../logger.js";

/**
 * Mirror the code-owned catalogue (`shared/src/catalogue.ts`) into the `games`
 * table at boot. The table exists so saves/progress/events/scores can reference a
 * real row; the code stays the source of truth, so adding a game is a code change
 * and never a manual INSERT.
 *
 * Rows for games removed from the catalogue are left alone — their saves are
 * still someone's data.
 */
export async function syncGameCatalogue(): Promise<void> {
  for (const game of GAMES) {
    await db
      .insertInto("games")
      .values({
        id: game.id,
        title: game.title,
        tagline: game.tagline,
        status: game.status,
        config: toJson(game.config),
        state_version: game.stateVersion,
      })
      .onConflict((oc) =>
        oc.column("id").doUpdateSet({
          title: game.title,
          tagline: game.tagline,
          status: game.status,
          config: toJson(game.config),
          state_version: game.stateVersion,
          updated_at: new Date(),
        }),
      )
      .execute();
  }

  logger.info({ games: GAMES.map((g) => g.id) }, "game catalogue synced");
}
