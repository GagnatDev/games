-- Up Migration

-- Leaderboard entries. `board` lets one game keep several rankings
-- ('career-cash', 'weekly-run', …) without a schema change; `details` carries
-- whatever the game wants to render beside the number.
--
-- double precision rather than numeric so the driver hands back a JS number.
CREATE TABLE IF NOT EXISTS game_scores (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  game_id      text NOT NULL REFERENCES games (id) ON DELETE CASCADE,
  board        text NOT NULL DEFAULT 'default',
  score        double precision NOT NULL,
  details      jsonb NOT NULL DEFAULT '{}'::jsonb,
  achieved_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT game_scores_board_slug CHECK (board ~ '^[a-z0-9][a-z0-9-]*$')
);

CREATE INDEX IF NOT EXISTS game_scores_board_idx
  ON game_scores (game_id, board, score DESC, achieved_at);

CREATE INDEX IF NOT EXISTS game_scores_user_idx
  ON game_scores (user_id, game_id, board, score DESC);

-- Down Migration
DROP TABLE IF EXISTS game_scores;
