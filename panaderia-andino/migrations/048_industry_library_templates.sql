-- MATTSYSTEM: biblioteca inicial de 15 rubros comerciales.
-- Las plantillas nuevas reutilizan módulos ya existentes y activos; no crean
-- funcionalidades nuevas ni alteran plantillas o licencias históricas.
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
