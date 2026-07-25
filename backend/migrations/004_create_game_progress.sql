-- Up Migration

-- Durable progression, one row per (player, game). Survives individual saves:
-- unlocks and lifetime stats outlive the run that earned them.
CREATE TABLE IF NOT EXISTS game_progress (
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  game_id         text NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  -- Unlocks, achievements, tech, levels — whatever the game means by progress.
  progression     jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Lifetime counters and aggregates the game defines.
  stats           jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_played_at  timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, game_id)
);

CREATE INDEX IF NOT EXISTS game_progress_progression_idx
  ON game_progress USING gin (progression jsonb_path_ops);

CREATE INDEX IF NOT EXISTS game_progress_stats_idx
  ON game_progress USING gin (stats jsonb_path_ops);

-- Down Migration
DROP TABLE IF EXISTS game_progress;
