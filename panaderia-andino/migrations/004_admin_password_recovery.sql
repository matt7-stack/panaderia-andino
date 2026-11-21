-- Secure administrator password recovery tokens. Additive and safe for existing accounts.
BEGIN;
CREATE TABLE IF NOT EXISTS app_password_resets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS app_password_resets_user_created_idx
  ON app_password_resets(user_id, created_at DESC);
COMMIT;
