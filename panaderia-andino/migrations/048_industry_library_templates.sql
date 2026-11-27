-- MATTSYSTEM: biblioteca inicial de 15 rubros comerciales.
-- Las plantillas nuevas reutilizan módulos ya existentes y activos; no crean
-- funcionalidades nuevas ni alteran plantillas o licencias históricas.
-- Expandir los CHECK existentes sin quitar compatibilidad a negocios históricos.
ALTER TABLE app_business_config DROP CONSTRAINT IF EXISTS app_business_config_industry_key_check;
ALTER TABLE app_business_config ADD CONSTRAINT app_business_config_industry_key_check
  CHECK (industry_key = ANY (ARRAY[
    'despensas_minimercados','tiendas_ropa_calzados','ferreterias','electronica_tecnologia',
    'comercios_generales','panaderias','restaurantes','cafeterias_bares','carnicerias_pollerias',
    'fruterias_verdulerias','talleres_mecanicos','barberias_peluquerias','centros_estetica',
    'reparacion_celulares_computadoras','empresas_servicios','otro_rubro',
    'minimercados','despensas','tiendas','farmacias','distribuidoras'
  ]));

ALTER TABLE app_quotations DROP CONSTRAINT IF EXISTS app_quotations_industry_key_check;
ALTER TABLE app_quotations ADD CONSTRAINT app_quotations_industry_key_check
  CHECK (industry_key = ANY (ARRAY[
    'despensas_minimercados','tiendas_ropa_calzados','ferreterias','electronica_tecnologia',
    'comercios_generales','panaderias','restaurantes','cafeterias_bares','carnicerias_pollerias',
    'fruterias_verdulerias','talleres_mecanicos','barberias_peluquerias','centros_estetica',
    'reparacion_celulares_computadoras','empresas_servicios','otro_rubro',
    'minimercados','despensas','tiendas','farmacias','distribuidoras'
  ]));

ALTER TABLE app_industry_templates DROP CONSTRAINT IF EXISTS app_industry_templates_industry_key_check;
ALTER TABLE app_industry_templates ADD CONSTRAINT app_industry_templates_industry_key_check
  CHECK (industry_key = ANY (ARRAY[
    'despensas_minimercados','tiendas_ropa_calzados','ferreterias','electronica_tecnologia',
    'comercios_generales','panaderias','restaurantes','cafeterias_bares','carnicerias_pollerias',
    'fruterias_verdulerias','talleres_mecanicos','barberias_peluquerias','centros_estetica',
    'reparacion_celulares_computadoras','empresas_servicios','otro_rubro',
    'minimercados','despensas','tiendas','farmacias','distribuidoras'
  ]));

WITH industry_sources(industry_key, source_industry) AS (
  VALUES
    ('despensas_minimercados', 'minimercados'),
    ('tiendas_ropa_calzados', 'tiendas'),
    ('ferreterias', 'ferreterias'),
    ('electronica_tecnologia', 'tiendas'),
    ('comercios_generales', 'comercios_generales'),
    ('panaderias', 'panaderias'),
    ('restaurantes', 'restaurantes'),
    ('cafeterias_bares', 'restaurantes'),
    ('carnicerias_pollerias', 'minimercados'),
    ('fruterias_verdulerias', 'minimercados'),
    ('talleres_mecanicos', 'comercios_generales'),
    ('barberias_peluquerias', 'comercios_generales'),
    ('centros_estetica', 'comercios_generales'),
    ('reparacion_celulares_computadoras', 'tiendas'),
    ('empresas_servicios', 'comercios_generales'),
    ('otro_rubro', 'comercios_generales')
)
INSERT INTO app_industry_templates (industry_key, module_key, enabled_by_default)
SELECT src.industry_key, template.module_key, template.enabled_by_default
FROM industry_sources src
JOIN app_industry_templates template
  ON template.industry_key = src.source_industry
ON CONFLICT (industry_key, module_key) DO NOTHING;

INSERT INTO schema_migrations(version) VALUES('048_industry_library_templates')
ON CONFLICT(version) DO NOTHING;
