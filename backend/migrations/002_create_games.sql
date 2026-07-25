-- Up Migration

-- The catalogue of games hosted at games.homectl.no/<id>. Rows are upserted at
-- boot from `shared/src/catalogue.ts`, which stays the source of truth — this
-- table exists so saves, progress, events and scores can key off a real row.
CREATE TABLE IF NOT EXISTS games (
  id             text PRIMARY KEY,
  title          text NOT NULL,
  tagline        text NOT NULL DEFAULT '',
  status         text NOT NULL DEFAULT 'shell',
  -- Static, game-owned configuration and tuning. Shape is the game's business.
  config         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The game's own schema version for the `state` documents it writes.
  state_version  integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT games_id_slug CHECK (id ~ '^[a-z0-9][a-z0-9-]*$'),
  CONSTRAINT games_status_known CHECK (status IN ('shell', 'alpha', 'beta', 'live'))
);

-- Down Migration
DROP TABLE IF EXISTS games;
