-- 049: separate optional onboarding configuration from license prices.
-- Existing license prices and issued licenses remain unchanged.
BEGIN;

ALTER TABLE app_license_plan_settings
  ADD COLUMN IF NOT EXISTS configuration_amount NUMERIC(14,2) NOT NULL DEFAULT 0
  CHECK (configuration_amount >= 0);

ALTER TABLE app_licenses
  ADD COLUMN IF NOT EXISTS configuration_amount NUMERIC(14,2) NOT NULL DEFAULT 0
  CHECK (configuration_amount >= 0);

UPDATE app_license_plan_settings
SET configuration_amount = CASE plan_key
  WHEN 'basic' THEN 250000
  WHEN 'professional' THEN 400000
  WHEN 'enterprise' THEN 600000
  ELSE configuration_amount
END,
updated_at = NOW()
WHERE plan_key IN ('basic','professional','enterprise');

INSERT INTO schema_migrations(version)
VALUES ('049_optional_onboarding_configuration')
ON CONFLICT(version) DO NOTHING;

COMMIT;
