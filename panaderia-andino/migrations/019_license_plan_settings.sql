-- 019: configurable license plan templates. Existing issued licenses are not changed.
BEGIN;
CREATE TABLE IF NOT EXISTS app_license_plan_settings (
  plan_key TEXT PRIMARY KEY CHECK (plan_key IN ('basic','professional','enterprise')),
  display_name TEXT NOT NULL,
  setup_amount NUMERIC(14,2) NOT NULL DEFAULT 1200000 CHECK (setup_amount >= 0),
  monthly_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (monthly_amount >= 0),
  user_limit INTEGER CHECK (user_limit IS NULL OR user_limit > 0),
  modules JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(modules)='array'),
  updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO app_license_plan_settings(plan_key,display_name,setup_amount,monthly_amount,user_limit,modules) VALUES
('basic','Básico',1200000,99000,NULL,'["dashboard","movements","invoices","products","sales","inventory","customers","cash"]'::jsonb),
('professional','Profesional',1200000,179000,NULL,'["dashboard","movements","invoices","products","sales","inventory","customers","cash","suppliers","purchases","reports"]'::jsonb),
('enterprise','Empresa',1200000,299000,NULL,'["dashboard","movements","invoices","products","sales","inventory","customers","cash","suppliers","purchases","reports","employees","users","recipes","production"]'::jsonb)
ON CONFLICT(plan_key) DO NOTHING;
INSERT INTO schema_migrations(version) VALUES('019_license_plan_settings') ON CONFLICT(version) DO NOTHING;
COMMIT;
