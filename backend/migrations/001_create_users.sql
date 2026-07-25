-- Up Migration

-- The app owns its player rows; homectl-auth only supplies identity. `auth_sub`
-- is the JWT `sub` the auth sidecar injects as X-Homectl-User, and it is the one
-- and only join point between the two systems.
CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_sub      text NOT NULL UNIQUE,
  email         text,
  display_name  text,
  -- The app-level role from the sidecar's X-Homectl-Role (see apps.json roles).
  app_role      text,
  -- Cross-game player preferences: theme, locale, accessibility, notification
  -- opt-ins. Generic on purpose — the platform never reads inside it.
  profile       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS users_profile_idx ON users USING gin (profile jsonb_path_ops);

-- Down Migration
DROP TABLE IF EXISTS users;
