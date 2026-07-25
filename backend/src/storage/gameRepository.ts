import { sql } from "kysely";
import type {
  EventsWrite,
  GameEventResponse,
  GameSummary,
  JsonObject,
  ProgressResponse,
  ProgressWrite,
  SaveResponse,
  SaveStatus,
  SaveWrite,
  ScoreEntry,
  ScoreWrite,
} from "@games/shared";
import { db } from "../db/kysely.js";
import { toJson } from "../db/schema.js";

/**
 * All game data access. Every function is scoped by `userId`, and every
 * game-specific document (`state`, `progression`, `stats`, `payload`, `details`)
 * is passed through as jsonb without inspection — this file has no idea what any
 * game stores, which is exactly the intent.
 */

// ── Catalogue ───────────────────────────────────────────────────────────────

export async function listGamesForUser(userId: string): Promise<GameSummary[]> {
  const rows = await db
    .selectFrom("games")
    .leftJoin("game_progress", (join) =>
      join
        .onRef("game_progress.game_id", "=", "games.id")
        .on("game_progress.user_id", "=", userId),
    )
    .select([
      "games.id as id",
      "games.title as title",
      "games.tagline as tagline",
      "games.status as status",
      "games.config as config",
      "game_progress.last_played_at as last_played_at",
    ])
    .orderBy("games.title")
    .execute();

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    tagline: row.tagline,
    status: row.status,
    config: (row.config ?? {}) as JsonObject,
    lastPlayedAt: row.last_played_at ? row.last_played_at.toISOString() : null,
  }));
}

// ── Saves ───────────────────────────────────────────────────────────────────

type SaveRow = {
  game_id: string;
  slot: string;
  label: string | null;
  status: SaveStatus;
  state: JsonObject;
  state_version: number;
  revision: number;
  played_seconds: number;
  last_played_at: Date;
  created_at: Date;
  updated_at: Date;
};

const SAVE_COLUMNS = sql`
  game_id, slot, label, status, state, state_version, revision,
  played_seconds, last_played_at, created_at, updated_at
`;

export async function getSave(
  userId: string,
  gameId: string,
  slot: string,
): Promise<SaveResponse | null> {
  const result = await sql<SaveRow>`
    SELECT ${SAVE_COLUMNS} FROM game_saves
    WHERE user_id = ${userId} AND game_id = ${gameId} AND slot = ${slot}
  `.execute(db);

  const row = result.rows[0];
  return row ? toSaveResponse(row) : null;
}

export async function listSaves(
  userId: string,
  gameId: string,
): Promise<SaveResponse[]> {
  const result = await sql<SaveRow>`
    SELECT ${SAVE_COLUMNS} FROM game_saves
    WHERE user_id = ${userId} AND game_id = ${gameId}
    ORDER BY last_played_at DESC
  `.execute(db);

  return result.rows.map(toSaveResponse);
}

export type SaveWriteResult =
  | { ok: true; save: SaveResponse }
  | { ok: false; conflict: true; currentRevision: number | null };

/**
 * Upsert a save slot.
 *
 * With `expectedRevision` this is a compare-and-set: the `DO UPDATE ... WHERE`
 * makes a stale write affect zero rows, which we report as 409 rather than
 * clobbering a newer state written from another device. Without it, the write is
 * last-write-wins (fine for a game that only ever runs in one tab).
 */
export async function writeSave(
  userId: string,
  gameId: string,
  slot: string,
  body: SaveWrite,
): Promise<SaveWriteResult> {
  const guard =
    body.expectedRevision === undefined
      ? sql`TRUE`
      : sql`game_saves.revision = ${body.expectedRevision}`;

  const result = await sql<SaveRow>`
    INSERT INTO game_saves (
      user_id, game_id, slot, label, status, state, state_version, played_seconds
    )
    VALUES (
      ${userId}, ${gameId}, ${slot}, ${body.label ?? null},
      ${body.status ?? "active"}, ${toJson(body.state)}::jsonb,
      ${body.stateVersion}, ${body.playedSeconds ?? 0}
    )
    ON CONFLICT (user_id, game_id, slot) DO UPDATE SET
      state          = EXCLUDED.state,
      state_version  = EXCLUDED.state_version,
      label          = COALESCE(EXCLUDED.label, game_saves.label),
      status         = EXCLUDED.status,
      played_seconds = GREATEST(game_saves.played_seconds, EXCLUDED.played_seconds),
      revision       = game_saves.revision + 1,
      last_played_at = now(),
      updated_at     = now()
    WHERE ${guard}
    RETURNING ${SAVE_COLUMNS}
  `.execute(db);

  const row = result.rows[0];
  if (row) {
    await touchProgress(userId, gameId);
    return { ok: true, save: toSaveResponse(row) };
  }

  // Zero rows means the revision guard failed; tell the client where we are so
  // it can merge and retry.
  const current = await getSave(userId, gameId, slot);
  return { ok: false, conflict: true, currentRevision: current?.revision ?? null };
}

export async function deleteSave(
  userId: string,
  gameId: string,
  slot: string,
): Promise<boolean> {
  const result = await db
    .deleteFrom("game_saves")
    .where("user_id", "=", userId)
    .where("game_id", "=", gameId)
    .where("slot", "=", slot)
    .executeTakeFirst();

  return Number(result.numDeletedRows ?? 0) > 0;
}

// ── Progression ─────────────────────────────────────────────────────────────

type ProgressRow = {
  game_id: string;
  progression: JsonObject;
  stats: JsonObject;
  last_played_at: Date | null;
  updated_at: Date;
};

export async function getProgress(
  userId: string,
  gameId: string,
): Promise<ProgressResponse> {
  const result = await sql<ProgressRow>`
    SELECT game_id, progression, stats, last_played_at, updated_at
    FROM game_progress WHERE user_id = ${userId} AND game_id = ${gameId}
  `.execute(db);

  const row = result.rows[0];
  if (!row) {
    return {
      gameId,
      progression: {},
      stats: {},
      lastPlayedAt: null,
      updatedAt: new Date(0).toISOString(),
    };
  }
  return toProgressResponse(row);
}

/**
 * `replace` swaps the documents wholesale; `merge` does a shallow jsonb merge
 * (`||`), which is the primitive a game wants for "unlock this one thing"
 * without reading the whole progression first.
 */
export async function writeProgress(
  userId: string,
  gameId: string,
  body: ProgressWrite,
  mode: "replace" | "merge",
): Promise<ProgressResponse> {
  const progression = toJson(body.progression ?? {});
  const stats = toJson(body.stats ?? {});

  const progressionUpdate =
    body.progression === undefined
      ? sql`game_progress.progression`
      : mode === "merge"
        ? sql`game_progress.progression || EXCLUDED.progression`
        : sql`EXCLUDED.progression`;

  const statsUpdate =
    body.stats === undefined
      ? sql`game_progress.stats`
      : mode === "merge"
        ? sql`game_progress.stats || EXCLUDED.stats`
        : sql`EXCLUDED.stats`;

  const result = await sql<ProgressRow>`
    INSERT INTO game_progress (user_id, game_id, progression, stats, last_played_at)
    VALUES (${userId}, ${gameId}, ${progression}::jsonb, ${stats}::jsonb, now())
    ON CONFLICT (user_id, game_id) DO UPDATE SET
      progression    = ${progressionUpdate},
      stats          = ${statsUpdate},
      last_played_at = now(),
      updated_at     = now()
    RETURNING game_id, progression, stats, last_played_at, updated_at
  `.execute(db);

  const row = result.rows[0];
  if (!row) throw new Error("failed to write progress");
  return toProgressResponse(row);
}

/** Keep `last_played_at` fresh on any save write, so the hub can sort by it. */
async function touchProgress(userId: string, gameId: string): Promise<void> {
  await sql`
    INSERT INTO game_progress (user_id, game_id, last_played_at)
    VALUES (${userId}, ${gameId}, now())
    ON CONFLICT (user_id, game_id) DO UPDATE SET
      last_played_at = now(), updated_at = now()
  `.execute(db);
}

// ── Events ──────────────────────────────────────────────────────────────────

export async function appendEvents(
  userId: string,
  gameId: string,
  body: EventsWrite,
): Promise<number> {
  // Keep the column set identical across rows so the multi-row insert stays one
  // statement with no DEFAULT placeholders.
  const rows = body.events.map((event) => ({
    user_id: userId,
    game_id: gameId,
    kind: event.kind,
    payload: toJson(event.payload),
    occurred_at: event.occurredAt ? new Date(event.occurredAt) : new Date(),
  }));

  const result = await db.insertInto("game_events").values(rows).executeTakeFirst();
  return Number(result.numInsertedOrUpdatedRows ?? rows.length);
}

export async function listEvents(
  userId: string,
  gameId: string,
  limit: number,
): Promise<GameEventResponse[]> {
  const rows = await db
    .selectFrom("game_events")
    .select(["id", "game_id", "kind", "payload", "occurred_at"])
    .where("user_id", "=", userId)
    .where("game_id", "=", gameId)
    .orderBy("occurred_at", "desc")
    .limit(limit)
    .execute();

  return rows.map((row) => ({
    id: row.id,
    gameId: row.game_id,
    kind: row.kind,
    payload: (row.payload ?? {}) as JsonObject,
    occurredAt: row.occurred_at.toISOString(),
  }));
}

// ── Scores ──────────────────────────────────────────────────────────────────

export async function recordScore(
  userId: string,
  gameId: string,
  body: ScoreWrite,
): Promise<void> {
  await db
    .insertInto("game_scores")
    .values({
      user_id: userId,
      game_id: gameId,
      board: body.board,
      score: body.score,
      details: toJson(body.details),
    })
    .execute();
}

type LeaderboardRow = {
  user_id: string;
  display_name: string | null;
  score: number;
  details: JsonObject;
  achieved_at: Date;
};

/** Best score per player on one board, highest first. */
export async function leaderboard(
  gameId: string,
  board: string,
  limit: number,
): Promise<ScoreEntry[]> {
  const result = await sql<LeaderboardRow>`
    WITH best AS (
      SELECT DISTINCT ON (s.user_id)
        s.user_id, s.score, s.details, s.achieved_at
      FROM game_scores s
      WHERE s.game_id = ${gameId} AND s.board = ${board}
      ORDER BY s.user_id, s.score DESC, s.achieved_at ASC
    )
    SELECT b.user_id, u.display_name, b.score, b.details, b.achieved_at
    FROM best b
    JOIN users u ON u.id = b.user_id
    ORDER BY b.score DESC, b.achieved_at ASC
    LIMIT ${limit}
  `.execute(db);

  return result.rows.map((row, index) => ({
    rank: index + 1,
    userId: row.user_id,
    displayName: row.display_name,
    score: Number(row.score),
    details: row.details ?? {},
    achievedAt: row.achieved_at.toISOString(),
  }));
}

// ── Mappers ─────────────────────────────────────────────────────────────────

function toSaveResponse(row: SaveRow): SaveResponse {
  return {
    gameId: row.game_id,
    slot: row.slot,
    label: row.label,
    status: row.status,
    state: row.state ?? {},
    stateVersion: row.state_version,
    revision: row.revision,
    playedSeconds: row.played_seconds,
    lastPlayedAt: row.last_played_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toProgressResponse(row: ProgressRow): ProgressResponse {
  return {
    gameId: row.game_id,
    progression: row.progression ?? {},
    stats: row.stats ?? {},
    lastPlayedAt: row.last_played_at ? row.last_played_at.toISOString() : null,
    updatedAt: row.updated_at.toISOString(),
  };
}
