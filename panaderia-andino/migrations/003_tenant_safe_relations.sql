-- ERP multiempresa: tenant-safe relationships and transaction detail tables
-- Additive migration; preserves all existing records.
BEGIN;

-- Composite keys let PostgreSQL enforce that related records belong to the same bakery.
CREATE UNIQUE INDEX IF NOT EXISTS app_products_business_id_id_uq ON app_products(business_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS app_customers_business_id_id_uq ON app_customers(business_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS app_suppliers_business_id_id_uq ON app_suppliers(business_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS app_recipes_business_id_id_uq ON app_recipes(business_id,id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='app_inventory_product_same_business') THEN
    ALTER TABLE app_inventory_movements ADD CONSTRAINT app_inventory_product_same_business
      FOREIGN KEY (business_id,product_id) REFERENCES app_products(business_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='app_purchase_supplier_same_business') THEN
    ALTER TABLE app_purchases ADD CONSTRAINT app_purchase_supplier_same_business
      FOREIGN KEY (business_id,supplier_id) REFERENCES app_suppliers(business_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='app_sale_customer_same_business') THEN
    ALTER TABLE app_sales ADD CONSTRAINT app_sale_customer_same_business
      FOREIGN KEY (business_id,customer_id) REFERENCES app_customers(business_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='app_recipe_product_same_business') THEN
    ALTER TABLE app_recipes ADD CONSTRAINT app_recipe_product_same_business
      FOREIGN KEY (business_id,product_id) REFERENCES app_products(business_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='app_batch_recipe_same_business') THEN
    ALTER TABLE app_production_batches ADD CONSTRAINT app_batch_recipe_same_business
      FOREIGN KEY (business_id,recipe_id) REFERENCES app_recipes(business_id,id) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='app_batch_product_same_business') THEN
    ALTER TABLE app_production_batches ADD CONSTRAINT app_batch_product_same_business
      FOREIGN KEY (business_id,product_id) REFERENCES app_products(business_id,id) NOT VALID;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS app_sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  sale_id UUID NOT NULL,
  product_id UUID,
  description TEXT NOT NULL,
  quantity NUMERIC(14,3) NOT NULL CHECK(quantity>0),
  unit_price NUMERIC(14,2) NOT NULL CHECK(unit_price>=0),
  line_total NUMERIC(14,2) NOT NULL CHECK(line_total>=0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (business_id,sale_id) REFERENCES app_sales(business_id,id) ON DELETE CASCADE,
  FOREIGN KEY (business_id,product_id) REFERENCES app_products(business_id,id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS app_purchase_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  purchase_id UUID NOT NULL,
  product_id UUID,
  description TEXT NOT NULL,
  quantity NUMERIC(14,3) NOT NULL CHECK(quantity>0),
  unit_cost NUMERIC(14,2) NOT NULL CHECK(unit_cost>=0),
  line_total NUMERIC(14,2) NOT NULL CHECK(line_total>=0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (business_id,purchase_id) REFERENCES app_purchases(business_id,id) ON DELETE CASCADE,
  FOREIGN KEY (business_id,product_id) REFERENCES app_products(business_id,id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS app_recipe_ingredients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  recipe_id UUID NOT NULL,
  product_id UUID NOT NULL,
  quantity NUMERIC(14,3) NOT NULL CHECK(quantity>0),
  unit TEXT NOT NULL DEFAULT 'unidad',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (business_id,recipe_id) REFERENCES app_recipes(business_id,id) ON DELETE CASCADE,
  FOREIGN KEY (business_id,product_id) REFERENCES app_products(business_id,id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS app_cash_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  cash_session_id UUID NOT NULL,
  movement_type TEXT NOT NULL CHECK(movement_type IN ('income','expense')),
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK(amount>0),
  payment_method TEXT,
  reference TEXT,
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (business_id,cash_session_id) REFERENCES app_cash_sessions(business_id,id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS app_sale_items_business_sale_idx ON app_sale_items(business_id,sale_id);
CREATE INDEX IF NOT EXISTS app_purchase_items_business_purchase_idx ON app_purchase_items(business_id,purchase_id);
CREATE INDEX IF NOT EXISTS app_recipe_ingredients_business_recipe_idx ON app_recipe_ingredients(business_id,recipe_id);
CREATE INDEX IF NOT EXISTS app_cash_movements_business_session_idx ON app_cash_movements(business_id,cash_session_id);

INSERT INTO schema_migrations(version) VALUES('003_tenant_safe_relations')
ON CONFLICT(version) DO NOTHING;
COMMIT;
