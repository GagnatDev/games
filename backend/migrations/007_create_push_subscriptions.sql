-- Up Migration

-- Web Push endpoints, one row per browser/device. The VAPID keypair itself is
-- Terraform-managed (`games-vapid-secrets`, vapid = true in homectl-infra) and
-- never stored here.
--
-- Rotating the VAPID keys invalidates every row in this table — subscriptions
-- are bound to the key they were created with.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  endpoint          text NOT NULL UNIQUE,
  p256dh            text NOT NULL,
  auth              text NOT NULL,
  -- Which games/topics this device wants pushes for; keys are game-defined.
  topics            jsonb NOT NULL DEFAULT '{}'::jsonb,
  user_agent        text,
  -- Consecutive delivery failures; a 404/410 from the push service deletes the
  -- row outright, anything else just increments this.
  failure_count     integer NOT NULL DEFAULT 0,
  last_success_at   timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON push_subscriptions (user_id);

CREATE INDEX IF NOT EXISTS push_subscriptions_topics_idx
  ON push_subscriptions USING gin (topics jsonb_path_ops);

-- Down Migration
DROP TABLE IF EXISTS push_subscriptions;
