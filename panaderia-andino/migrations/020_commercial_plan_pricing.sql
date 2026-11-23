-- 020: commercial pricing per license plan and per included module.
BEGIN;
ALTER TABLE app_license_plan_settings
  ADD COLUMN IF NOT EXISTS annual_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 15 CHECK (annual_discount_percent BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS permanent_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (permanent_price >= 0),
  ADD COLUMN IF NOT EXISTS full_sale_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (full_sale_price >= 0),
  ADD COLUMN IF NOT EXISTS module_prices JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(module_prices)='object');
UPDATE app_license_plan_settings SET
  permanent_price=CASE plan_key WHEN 'basic' THEN 3500000 WHEN 'professional' THEN 5500000 ELSE 8500000 END,
  full_sale_price=CASE plan_key WHEN 'basic' THEN 8000000 WHEN 'professional' THEN 12000000 ELSE 18000000 END
WHERE permanent_price=0 AND full_sale_price=0;
INSERT INTO schema_migrations(version) VALUES('020_commercial_plan_pricing') ON CONFLICT(version) DO NOTHING;
COMMIT;
