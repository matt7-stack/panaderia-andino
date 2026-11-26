-- 046: make the implemented Sucursales and Pedidos y entregas modules available in license plans.
-- Does not add either module to existing plans or issued licenses; the platform administrator
-- chooses the plans that include them from "Módulos incluidos".
BEGIN;

UPDATE app_module_catalog
SET active=TRUE,
    implemented=TRUE,
    title=CASE module_key
      WHEN 'branches' THEN 'Sucursales'
      WHEN 'delivery' THEN 'Pedidos y entregas'
      ELSE title
    END,
    description=CASE module_key
      WHEN 'branches' THEN 'Gestión de sucursales, responsables y operaciones por sede'
      WHEN 'delivery' THEN 'Gestión de pedidos, preparación, reparto y entregas'
      ELSE description
    END,
    category=CASE module_key
      WHEN 'branches' THEN 'expansion'
      WHEN 'delivery' THEN 'logistica'
      ELSE category
    END,
    sort_order=CASE module_key
      WHEN 'branches' THEN 160
      WHEN 'delivery' THEN 170
      ELSE sort_order
    END,
    updated_at=NOW()
WHERE module_key IN ('branches','delivery');

INSERT INTO schema_migrations(version)
VALUES ('046_license_catalog_branches_delivery')
ON CONFLICT(version) DO NOTHING;

COMMIT;
