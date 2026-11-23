-- 014: add the requested business industries without changing existing templates.
BEGIN;
ALTER TABLE app_business_config DROP CONSTRAINT IF EXISTS app_business_config_industry_key_check;
ALTER TABLE app_business_config ADD CONSTRAINT app_business_config_industry_key_check
  CHECK (industry_key = ANY (ARRAY[
    'panaderias','minimercados','despensas','ferreterias','farmacias',
    'tiendas','restaurantes','comercios_generales','distribuidoras'
  ]));
ALTER TABLE app_industry_templates DROP CONSTRAINT IF EXISTS app_industry_templates_industry_key_check;
ALTER TABLE app_industry_templates ADD CONSTRAINT app_industry_templates_industry_key_check
  CHECK (industry_key = ANY (ARRAY[
    'panaderias','minimercados','despensas','ferreterias','farmacias',
    'tiendas','restaurantes','comercios_generales','distribuidoras'
  ]));
INSERT INTO app_industry_templates(industry_key,module_key,enabled_by_default)
SELECT x.industry_key,x.module_key,x.enabled_by_default
FROM (VALUES
  ('despensas','dashboard',TRUE),('despensas','movements',TRUE),('despensas','invoices',TRUE),
  ('despensas','products',TRUE),('despensas','sales',TRUE),('despensas','inventory',TRUE),
  ('despensas','customers',TRUE),('despensas','suppliers',TRUE),('despensas','purchases',TRUE),
  ('despensas','cash',TRUE),('despensas','reports',TRUE),('despensas','employees',TRUE),('despensas','users',TRUE),
  ('despensas','recipes',FALSE),('despensas','production',FALSE),
  ('ferreterias','dashboard',TRUE),('ferreterias','movements',TRUE),('ferreterias','invoices',TRUE),
  ('ferreterias','products',TRUE),('ferreterias','sales',TRUE),('ferreterias','inventory',TRUE),
  ('ferreterias','customers',TRUE),('ferreterias','suppliers',TRUE),('ferreterias','purchases',TRUE),
  ('ferreterias','cash',TRUE),('ferreterias','reports',TRUE),('ferreterias','employees',TRUE),('ferreterias','users',TRUE),
  ('ferreterias','recipes',FALSE),('ferreterias','production',FALSE),
  ('farmacias','dashboard',TRUE),('farmacias','movements',TRUE),('farmacias','invoices',TRUE),
  ('farmacias','products',TRUE),('farmacias','sales',TRUE),('farmacias','inventory',TRUE),
  ('farmacias','customers',TRUE),('farmacias','suppliers',TRUE),('farmacias','purchases',TRUE),
  ('farmacias','cash',TRUE),('farmacias','reports',TRUE),('farmacias','employees',TRUE),('farmacias','users',TRUE),
  ('farmacias','recipes',FALSE),('farmacias','production',FALSE)
) AS x(industry_key,module_key,enabled_by_default)
ON CONFLICT(industry_key,module_key) DO UPDATE SET enabled_by_default=EXCLUDED.enabled_by_default;
INSERT INTO schema_migrations(version) VALUES('014_expand_industry_templates')
ON CONFLICT(version) DO NOTHING;
COMMIT;
