import type { Generated, JSONColumnType } from "kysely";
import type { GameStatus, JsonObject, SaveStatus } from "@games/shared";

/**
 * Kysely's view of the schema. Mirrors `backend/migrations/*.sql`.
 *
 * Note what is *not* here: any game's internal structures. Every game-specific
 * document is a `JSONColumnType<JsonObject>` — selected as a parsed object,
 * written as a JSON string (see `toJson()` in the repositories). That is the
 * whole point of the design: adding a game never touches this file.
 */

export interface UsersTable {
  id: Generated<string>;
  auth_sub: string;
  email: string | null;
  display_name: string | null;
  app_role: string | null;
  profile: JSONColumnType<JsonObject>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface GamesTable {
  id: string;
  title: string;
  tagline: Generated<string>;
  status: Generated<GameStatus>;
  config: JSONColumnType<JsonObject>;
  state_version: Generated<number>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface GameSavesTable {
  id: Generated<string>;
  user_id: string;
  game_id: string;
  slot: Generated<string>;
  label: string | null;
  status: Generated<SaveStatus>;
  state: JSONColumnType<JsonObject>;
  state_version: Generated<number>;
  revision: Generated<number>;
  played_seconds: Generated<number>;
  last_played_at: Generated<Date>;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface GameProgressTable {
  user_id: string;
  game_id: string;
  progression: JSONColumnType<JsonObject>;
  stats: JSONColumnType<JsonObject>;
  last_played_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface GameEventsTable {
  id: Generated<string>;
  user_id: string;
  game_id: string;
  save_id: string | null;
  kind: string;
  payload: JSONColumnType<JsonObject>;
  occurred_at: Generated<Date>;
  created_at: Generated<Date>;
}

export interface GameScoresTable {
  id: Generated<string>;
  user_id: string;
  game_id: string;
  board: Generated<string>;
  score: number;
  details: JSONColumnType<JsonObject>;
  achieved_at: Generated<Date>;
}

export interface PushSubscriptionsTable {
  id: Generated<string>;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  topics: JSONColumnType<JsonObject>;
  user_agent: string | null;
  failure_count: Generated<number>;
  last_success_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface Database {
  users: UsersTable;
  games: GamesTable;
  game_saves: GameSavesTable;
  game_progress: GameProgressTable;
  game_events: GameEventsTable;
  game_scores: GameScoresTable;
  push_subscriptions: PushSubscriptionsTable;
}

/** jsonb columns are written as JSON text — explicit beats relying on the driver. */
export function toJson(value: unknown): string {
  return JSON.stringify(value ?? {});
}
