import { Client } from "pg";
import { test as base } from "@playwright/test";
import { readStackInfo } from "./stack";

/**
 * `AUTH_MODE=dev` means every browser in the suite is the same player, so tests
 * would otherwise see each other's saves. Truncating player-owned data before
 * each test keeps them independent (and is why the suite runs with one worker).
 *
 * The `games` table is left alone: it is seeded from the code-owned catalogue when
 * the backend boots, not per test.
 */
export const test = base.extend<{ cleanDatabase: void }>({
  cleanDatabase: [
    async ({}, use) => {
      const client = new Client({ connectionString: readStackInfo().databaseUrl });
      await client.connect();
      try {
        await client.query(`
          TRUNCATE users, game_saves, game_progress, game_events, game_scores,
                   push_subscriptions
          RESTART IDENTITY CASCADE
        `);
      } finally {
        await client.end();
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
