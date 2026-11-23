-- 018: remember the license code verified by each business user.
ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS verified_license_id uuid REFERENCES app_licenses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS app_users_verified_license_idx ON app_users(verified_license_id);
INSERT INTO schema_migrations(version) VALUES ('018_user_verified_license')
ON CONFLICT (version) DO NOTHING;
