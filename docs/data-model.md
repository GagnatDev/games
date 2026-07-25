# Data model

The design rule: **the database describes gameplay in general, never any game in
particular.** Every game-specific structure is a jsonb document the platform stores
and returns verbatim. Adding a game touches no table and no migration.

That is why the tables below talk about saves, slots, revisions, progression,
events and scores — and never about ships, ports or cargo.

## Tables

| Table | Grain | jsonb columns | What it is for |
|-------|-------|---------------|----------------|
| `users` | one per player | `profile` | The app's own player row, keyed by `auth_sub` (the auth service's `sub`). `profile` holds cross-game preferences. |
| `games` | one per game | `config` | The catalogue, upserted at boot from `shared/src/catalogue.ts`. Exists so the other tables can reference a real row. |
| `game_saves` | (player, game, slot) | `state` | The entire game state. Carries the generic envelope: `slot`, `status`, `state_version`, `revision`, `played_seconds`. |
| `game_progress` | (player, game) | `progression`, `stats` | Durable progression that outlives a single run — unlocks, achievements, lifetime counters. |
| `game_events` | append-only | `payload` | Game-defined events (`kind` is a free string). Achievements, analytics and "what happened last voyage" all read from here. |
| `game_scores` | one per score | `details` | Leaderboards. `board` lets one game keep several rankings without a schema change. |
| `push_subscriptions` | one per device | `topics` | Web Push endpoints. The VAPID keypair itself is Terraform-managed and never stored. |

Every jsonb column carries a `jsonb_path_ops` GIN index, so a game can query
inside its own documents (`state @> '{"port":"oslo"}'`) without new columns.

Everything player-owned cascades from `users`, so deleting a player really deletes
their data.

### The two version numbers

- `state_version` — the **game's** version of its own `state` shape. The game bumps
  it and migrates its own saves in its own code (`frontend/src/games/landfall/state.ts`
  shows the pattern). No database migration involved.
- `revision` — optimistic concurrency. A client sends the `revision` it read; the
  `ON CONFLICT ... DO UPDATE ... WHERE revision = $n` makes a stale write affect
  zero rows, which the API reports as `409 revision_conflict` with the current
  revision attached. Omit it and the write is last-write-wins.

Without `revision`, a second device (or a tab restored from the background) would
silently overwrite newer state. With it, the client is told and can merge.

## API

All routes are under `/api`, all authenticated, all scoped to the calling player.
Request and response shapes live in `shared/src/api.ts` as Zod schemas — the
backend parses with them, the frontend imports the inferred types.

| Method | Path | Notes |
|--------|------|-------|
| `GET` | `/session` | Cheap "am I still signed in?" probe; the PWA calls it on focus. |
| `GET` `PATCH` | `/me` | Player profile. `PATCH` accepts `displayName` and a `profile` document. |
| `GET` | `/games` | The catalogue, with this player's `lastPlayedAt`. |
| `GET` | `/games/:id/saves` | Every slot, most recently played first. |
| `GET` `PUT` `DELETE` | `/games/:id/saves/:slot` | `PUT` upserts; send `expectedRevision` for compare-and-set. |
| `GET` | `/games/:id/progress` | Empty documents rather than 404 when untouched. |
| `PUT` `PATCH` | `/games/:id/progress` | `PUT` replaces the documents; `PATCH` shallow-merges them (jsonb `||`) — the primitive for "unlock this one thing". |
| `POST` `GET` | `/games/:id/events` | Append up to 100 at a time; read newest first. |
| `POST` `GET` | `/games/:id/scores` | `GET` returns the best score per player on a board, ranked. |
| `GET` | `/push/config` | The VAPID public key, or `null` when push is unconfigured. |
| `POST` `DELETE` | `/push/subscriptions` | Enrol / remove this device. |
| `POST` | `/push/test` | Send a notification to the caller's own devices — the VAPID smoke test. |

An unknown `:id` is a `404 unknown_game`: ids are validated against the code-owned
catalogue, so a typo can't create orphan rows.

## Guard rails on jsonb

The platform validates only that a document is a JSON object under
`MAX_JSON_BYTES` (256 KiB) — `shared/src/json.ts`. Real structure is enforced by
each game's own Zod schema, in the game's own chunk, because that is the only place
that knows what the document means.

## Deliberate non-goals

- **No local-first sync.** Saves are server-authoritative with optimistic
  concurrency. A game that wants offline play should bring its own local store and
  its own merge rules; the envelope here is ready for that (`revision` is the hook)
  but the platform does not presume it.
- **No cross-game leaderboard or currency.** Nothing in the schema encourages
  coupling games together.
- **No per-game tables.** If a game genuinely outgrows jsonb, it gets its own
  tables named after itself — it does not push its concepts into the generic ones.
