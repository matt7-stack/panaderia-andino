-- 050: persist the independently selected initial-configuration package on each license.
BEGIN;
ALTER TABLE app_licenses
  ADD COLUMN IF NOT EXISTS configuration_plan TEXT
  CHECK (configuration_plan IS NULL OR configuration_plan IN ('basic','professional','enterprise'));
UPDATE app_licenses
SET configuration_plan = plan
WHERE configuration_amount > 0 AND configuration_plan IS NULL;
INSERT INTO schema_migrations(version)
VALUES ('050_independent_license_configuration_tier')
ON CONFLICT(version) DO NOTHING;
COMMIT;
