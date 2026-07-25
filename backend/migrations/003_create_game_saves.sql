-- Up Migration

-- One row per (player, game, slot). `state` is the entire game state as jsonb:
-- the platform stores and returns it verbatim and has no opinion on its shape.
-- Everything outside `state` is the generic envelope every game shares.
CREATE TABLE IF NOT EXISTS game_saves (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  game_id         text NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  -- Games that only ever need one save just use the 'default' slot.
  slot            text NOT NULL DEFAULT 'default',
  label           text,
  status          text NOT NULL DEFAULT 'active',
  state           jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Game-owned version of `state`, so a game can migrate its own saves without
  -- a database migration.
  state_version   integer NOT NULL DEFAULT 1,
  -- Optimistic concurrency for multi-device / offline-capable clients: a write
  -- that carries a stale revision is rejected instead of silently overwriting.
  revision        integer NOT NULL DEFAULT 1,
  played_seconds  integer NOT NULL DEFAULT 0,
  last_played_at  timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT game_saves_slot_slug CHECK (slot ~ '^[a-z0-9][a-z0-9-]*$'),
  CONSTRAINT game_saves_status_known CHECK (status IN ('active', 'completed', 'abandoned')),
  CONSTRAINT game_saves_unique_slot UNIQUE (user_id, game_id, slot)
);

CREATE INDEX IF NOT EXISTS game_saves_user_game_idx
  ON game_saves (user_id, game_id, last_played_at DESC);

CREATE INDEX IF NOT EXISTS game_saves_state_idx
  ON game_saves USING gin (state jsonb_path_ops);

-- Down Migration
DROP TABLE IF EXISTS game_saves;
