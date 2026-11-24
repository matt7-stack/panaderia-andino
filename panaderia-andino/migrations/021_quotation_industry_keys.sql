-- 021: keep quotation industry keys aligned with the expanded business industry catalog.
-- Migration 014 expanded app_business_config and app_industry_templates but omitted app_quotations.
BEGIN;

ALTER TABLE app_quotations
  DROP CONSTRAINT IF EXISTS app_quotations_industry_key_check;

ALTER TABLE app_quotations
  ADD CONSTRAINT app_quotations_industry_key_check
  CHECK (industry_key = ANY (ARRAY[
    'panaderias',
    'minimercados',
    'despensas',
    'ferreterias',
    'farmacias',
    'tiendas',
    'restaurantes',
    'comercios_generales',
    'distribuidoras'
  ]));

INSERT INTO schema_migrations(version)
VALUES ('021_quotation_industry_keys')
ON CONFLICT(version) DO NOTHING;

COMMIT;
