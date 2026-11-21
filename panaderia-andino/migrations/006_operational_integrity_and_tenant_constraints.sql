BEGIN;

-- Activar las relaciones compuestas que impiden enlazar registros de otro negocio.
-- Se verificaron cero referencias cruzadas en la base principal antes de preparar esta migración.
ALTER TABLE app_inventory_movements VALIDATE CONSTRAINT app_inventory_product_same_business;
ALTER TABLE app_production_batches VALIDATE CONSTRAINT app_batch_product_same_business;
ALTER TABLE app_production_batches VALIDATE CONSTRAINT app_batch_recipe_same_business;
ALTER TABLE app_purchases VALIDATE CONSTRAINT app_purchase_supplier_same_business;
ALTER TABLE app_recipes VALIDATE CONSTRAINT app_recipe_product_same_business;
ALTER TABLE app_sales VALIDATE CONSTRAINT app_sale_customer_same_business;

-- Impedir dos cajas abiertas simultáneas para un mismo negocio, incluso con solicitudes concurrentes.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT business_id
    FROM app_cash_sessions
    WHERE status='open'
    GROUP BY business_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Hay negocios con más de una caja abierta; corregí esos registros antes de continuar.';
  END IF;
END
$migration$;

CREATE UNIQUE INDEX IF NOT EXISTS app_cash_sessions_one_open_per_business
  ON app_cash_sessions(business_id)
  WHERE status='open';

INSERT INTO schema_migrations(version)
VALUES ('006_operational_integrity_and_tenant_constraints')
ON CONFLICT (version) DO NOTHING;

COMMIT;
