CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;
CREATE TABLE IF NOT EXISTS app_admin_setup_tokens (
  token_hash text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE TABLE IF NOT EXISTS app_license_settings (
  setting_key text PRIMARY KEY DEFAULT 'default',
  currency_mode text NOT NULL DEFAULT 'both' CHECK (currency_mode IN ('PYG','USD','both')),
  billing_mode text NOT NULL DEFAULT 'both' CHECK (billing_mode IN ('monthly','annual','both')),
  trial_enabled boolean NOT NULL DEFAULT true,
  trial_days integer NOT NULL DEFAULT 7 CHECK (trial_days BETWEEN 1 AND 90),
  activation_mode text NOT NULL DEFAULT 'manual' CHECK (activation_mode IN ('manual','automatic')),
  device_limit integer DEFAULT 3 CHECK (device_limit IS NULL OR device_limit BETWEEN 1 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL
);
INSERT INTO app_license_settings(setting_key,currency_mode,billing_mode,trial_enabled,trial_days,activation_mode,device_limit)
VALUES ('default','both','both',TRUE,7,'manual',3)
ON CONFLICT (setting_key) DO NOTHING;
ALTER TABLE app_license_payments ALTER COLUMN amount TYPE numeric;
ALTER TABLE app_licenses
  ALTER COLUMN setup_amount TYPE numeric,
  ALTER COLUMN monthly_amount TYPE numeric,
  ADD COLUMN IF NOT EXISTS is_trial boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trial_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_days integer,
  ADD COLUMN IF NOT EXISTS device_limit integer,
  ADD COLUMN IF NOT EXISTS user_limit integer;
ALTER TABLE app_licenses ADD CONSTRAINT app_licenses_user_limit_check
  CHECK (user_limit IS NULL OR (user_limit >= 1 AND user_limit <= 500));
CREATE TABLE IF NOT EXISTS app_platform_settings (
  setting_key text PRIMARY KEY,
  whatsapp_phone text NOT NULL DEFAULT '595987426497',
  enabled boolean NOT NULL DEFAULT true,
  welcome_message text NOT NULL DEFAULT 'Hola, necesito ayuda con Gestión de Negocio.',
  display_name text NOT NULL DEFAULT 'Soporte técnico Gestión de Negocio',
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS permissions jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS app_users_business_role_active_idx ON app_users(business_id,role,active);
INSERT INTO schema_migrations(version) VALUES ('004_platform_settings_trials_permissions')
ON CONFLICT (version) DO NOTHING;