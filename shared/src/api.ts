import { z } from "zod";
import { jsonObject, type JsonObject } from "./json.js";
import type { GameStatus } from "./catalogue.js";

/**
 * The wire contract between the SPA and the API.
 *
 * Everything game-specific travels inside a `jsonObject` the platform stores
 * verbatim as jsonb. What is typed here is only the *envelope*: who owns the
 * row, which game it belongs to, which slot, and the concurrency/versioning
 * fields that make multi-device play safe.
 */

// ── Player profile ──────────────────────────────────────────────────────────

export const profileUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    /** Free-form, cross-game player preferences (theme, locale, a11y, …). */
    profile: jsonObject.optional(),
  })
  .strict();

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export type MeResponse = {
  id: string;
  email: string | null;
  displayName: string | null;
  role: string | null;
  profile: JsonObject;
  createdAt: string;
};

// ── Saves (game state) ──────────────────────────────────────────────────────

export const SAVE_STATUSES = ["active", "completed", "abandoned"] as const;
export const saveStatusSchema = z.enum(SAVE_STATUSES);
export type SaveStatus = (typeof SAVE_STATUSES)[number];

/** Default save slot, so a game that never needs multiple saves can ignore slots. */
export const DEFAULT_SLOT = "default";

export const slotSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "slot must be kebab-case");

export const saveWriteSchema = z
  .object({
    /** The whole game state, opaque to the platform. */
    state: jsonObject,
    /** The game's own schema version for `state`. */
    stateVersion: z.number().int().positive().max(1_000_000),
    /**
     * Optimistic concurrency. Send the `revision` you last read; the server
     * rejects the write with 409 if the row moved on since. Omit only for the
     * very first write of a slot.
     */
    expectedRevision: z.number().int().nonnegative().optional(),
    status: saveStatusSchema.optional(),
    label: z.string().trim().max(120).nullish(),
    /** Monotonic play time in seconds; the server keeps the larger value. */
    playedSeconds: z.number().int().nonnegative().max(2_000_000_000).optional(),
  })
  .strict();

export type SaveWrite = z.infer<typeof saveWriteSchema>;

export type SaveResponse = {
  gameId: string;
  slot: string;
  label: string | null;
  status: SaveStatus;
  state: JsonObject;
  stateVersion: number;
  revision: number;
  playedSeconds: number;
  lastPlayedAt: string;
  createdAt: string;
  updatedAt: string;
};

// ── Progression (durable, survives individual saves) ────────────────────────

export const progressWriteSchema = z
  .object({
    /** Unlocks, achievements, tech, levels — game-defined. */
    progression: jsonObject.optional(),
    /** Lifetime counters and aggregates — game-defined. */
    stats: jsonObject.optional(),
  })
  .strict()
  .refine((body) => body.progression !== undefined || body.stats !== undefined, {
    message: "provide at least one of `progression` or `stats`",
  });

export type ProgressWrite = z.infer<typeof progressWriteSchema>;

export type ProgressResponse = {
  gameId: string;
  progression: JsonObject;
  stats: JsonObject;
  lastPlayedAt: string | null;
  updatedAt: string;
};

// ── Events (append-only, per game) ──────────────────────────────────────────

export const MAX_EVENTS_PER_REQUEST = 100;

export const gameEventSchema = z
  .object({
    /** Game-defined event name, e.g. `voyage.completed`. */
    kind: z.string().trim().min(1).max(120),
    payload: jsonObject.default({}),
    occurredAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const eventsWriteSchema = z
  .object({
    events: z.array(gameEventSchema).min(1).max(MAX_EVENTS_PER_REQUEST),
  })
  .strict();

export type GameEventWrite = z.infer<typeof gameEventSchema>;
export type EventsWrite = z.infer<typeof eventsWriteSchema>;

export type GameEventResponse = {
  id: string;
  gameId: string;
  kind: string;
  payload: JsonObject;
  occurredAt: string;
};

// ── Scores / leaderboards ───────────────────────────────────────────────────

export const boardSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "board must be kebab-case");

export const scoreWriteSchema = z
  .object({
    /** Which board; a game may keep several (`career-cash`, `weekly-run`, …). */
    board: boardSchema.default("default"),
    score: z.number().finite(),
    /** Anything the game wants to show next to the number. */
    details: jsonObject.default({}),
  })
  .strict();

export type ScoreWrite = z.infer<typeof scoreWriteSchema>;

export type ScoreEntry = {
  rank: number;
  userId: string;
  displayName: string | null;
  score: number;
  details: JsonObject;
  achievedAt: string;
};

// ── Catalogue ───────────────────────────────────────────────────────────────

export type GameSummary = {
  id: string;
  title: string;
  tagline: string;
  status: GameStatus;
  config: JsonObject;
  /** Player-scoped: null when the player has never opened this game. */
  lastPlayedAt: string | null;
};

// ── Web Push ────────────────────────────────────────────────────────────────

export const pushSubscribeSchema = z
  .object({
    endpoint: z.string().url().max(2048),
    keys: z
      .object({
        p256dh: z.string().min(1).max(512),
        auth: z.string().min(1).max(512),
      })
      .strict(),
    /** Which games/topics this device wants pushes for; game-defined keys. */
    topics: jsonObject.default({}),
  })
  .strict();

export const pushUnsubscribeSchema = z
  .object({ endpoint: z.string().url().max(2048) })
  .strict();

export type PushSubscribe = z.infer<typeof pushSubscribeSchema>;

export type PushConfigResponse = {
  /** null when the deployment has no VAPID keys — the SPA hides push entirely. */
  publicKey: string | null;
};

// ── Session ─────────────────────────────────────────────────────────────────

/**
 * Cheap "am I still signed in?" probe. The PWA calls it on focus so an expired
 * session surfaces as a deliberate re-login instead of a mid-action failure.
 */
export type SessionResponse = {
  authenticated: true;
  userId: string;
  role: string | null;
};

// ── Errors ──────────────────────────────────────────────────────────────────

export type ApiError = {
  error: string;
  message?: string;
  /** Present on 409 from a save write: the revision the server currently holds. */
  currentRevision?: number;
  details?: unknown;
};
