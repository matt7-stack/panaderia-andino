-- Add per-plan device limits. NULL means unlimited.
ALTER TABLE app_license_plan_settings
  ADD COLUMN IF NOT EXISTS device_limit INTEGER;

ALTER TABLE app_license_plan_settings
  DROP CONSTRAINT IF EXISTS app_license_plan_settings_device_limit_check;

ALTER TABLE app_license_plan_settings
  ADD CONSTRAINT app_license_plan_settings_device_limit_check
  CHECK (device_limit IS NULL OR device_limit BETWEEN 1 AND 100);
