import { sql } from "kysely";
import request from "supertest";
import { createApp } from "../app.js";
import { db } from "../db/kysely.js";

/** A supertest agent against a fresh app instance (AUTH_MODE=dev). */
export function api() {
  return request(createApp());
}

/**
 * Wipe player-owned data between tests. `games` is left in place — it is seeded
 * from the code-owned catalogue at boot, not per test.
 */
export async function resetDb(): Promise<void> {
  await sql`
    TRUNCATE users, game_saves, game_progress, game_events, game_scores,
             push_subscriptions
    RESTART IDENTITY CASCADE
  `.execute(db);
}

/** Act as a specific player; the dev auth provider keys off `x-dev-sub`. */
export function asPlayer(sub: string): Record<string, string> {
  return { "x-dev-sub": sub };
}
