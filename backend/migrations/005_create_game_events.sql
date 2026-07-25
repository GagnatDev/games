-- Up Migration

-- Append-only, game-defined event log. Generic by design: `kind` is a free
-- string the game chooses and `payload` is its jsonb. Achievements, analytics,
-- and "what happened last voyage" feeds all read from here without the platform
-- needing to know any game's vocabulary.
CREATE TABLE IF NOT EXISTS game_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  game_id      text NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  save_id      uuid REFERENCES game_saves (id) ON DELETE SET NULL,
  kind         text NOT NULL,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS game_events_user_game_idx
  ON game_events (user_id, game_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS game_events_game_kind_idx
  ON game_events (game_id, kind, occurred_at DESC);

CREATE INDEX IF NOT EXISTS game_events_payload_idx
  ON game_events USING gin (payload jsonb_path_ops);

-- Down Migration
DROP TABLE IF EXISTS game_events;
