-- 009: commercial base pricing and quotation snapshots.
BEGIN;
CREATE TABLE IF NOT EXISTS app_commercial_settings (
  setting_key TEXT PRIMARY KEY DEFAULT 'default',
  monthly_base NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(monthly_base>=0),
  annual_discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK(annual_discount_percent>=0 AND annual_discount_percent<=100),
  permanent_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(permanent_price>=0),
  full_sale_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(full_sale_price>=0),
  setup_fee NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(setup_fee>=0),
  currency TEXT NOT NULL DEFAULT 'PYG',
  updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO app_commercial_settings(setting_key) VALUES('default') ON CONFLICT(setting_key) DO NOTHING;
ALTER TABLE app_quotations ADD COLUMN IF NOT EXISTS price_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb;
INSERT INTO schema_migrations(version) VALUES('009_commercial_pricing') ON CONFLICT(version) DO NOTHING;
COMMIT;