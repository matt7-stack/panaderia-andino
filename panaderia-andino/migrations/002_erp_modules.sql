-- Panadería Andino ERP multiempresa: migration 002
-- Safe additive migration. No existing business, user, sale, or financial record is deleted.
BEGIN;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS address TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS phone TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS email TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS ruc TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS owner_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TABLE IF NOT EXISTS app_audit_logs (
  id BIGSERIAL PRIMARY KEY,
  business_id UUID REFERENCES businesses(id) ON DELETE RESTRICT,
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb, ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS app_audit_logs_business_created_idx ON app_audit_logs(business_id,created_at DESC);

CREATE TABLE IF NOT EXISTS app_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  name TEXT NOT NULL, document TEXT, phone TEXT, email TEXT, address TEXT, notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(business_id,document)
);
CREATE TABLE IF NOT EXISTS app_suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  name TEXT NOT NULL, ruc TEXT, phone TEXT, email TEXT, address TEXT, notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(business_id,ruc)
);
CREATE TABLE IF NOT EXISTS app_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  sku TEXT, name TEXT NOT NULL, category TEXT, unit TEXT NOT NULL DEFAULT 'unidad',
  sale_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(sale_price>=0),
  cost_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(cost_price>=0),
  stock NUMERIC(14,3) NOT NULL DEFAULT 0, min_stock NUMERIC(14,3) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(business_id,sku)
);
CREATE TABLE IF NOT EXISTS app_inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  product_id UUID NOT NULL REFERENCES app_products(id) ON DELETE RESTRICT,
  movement_type TEXT NOT NULL CHECK(movement_type IN ('entry','exit','adjustment','waste')),
  quantity NUMERIC(14,3) NOT NULL CHECK(quantity>0), unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  reference TEXT, notes TEXT, actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS app_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  supplier_id UUID REFERENCES app_suppliers(id) ON DELETE RESTRICT, document_number TEXT,
  status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('draft','received','cancelled')),
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0, total NUMERIC(14,2) NOT NULL DEFAULT 0,
  due_date DATE, notes TEXT, actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS app_sales (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  customer_id UUID REFERENCES app_customers(id) ON DELETE RESTRICT, sale_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('draft','completed','cancelled')),
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0, discount NUMERIC(14,2) NOT NULL DEFAULT 0,
  total NUMERIC(14,2) NOT NULL DEFAULT 0, payment_method TEXT, notes TEXT,
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id,sale_number)
);
CREATE TABLE IF NOT EXISTS app_cash_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  opened_by UUID REFERENCES app_users(id) ON DELETE SET NULL, closed_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  opening_amount NUMERIC(14,2) NOT NULL DEFAULT 0, closing_amount NUMERIC(14,2),
  expected_amount NUMERIC(14,2), difference NUMERIC(14,2),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), closed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS app_recipes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  product_id UUID REFERENCES app_products(id) ON DELETE SET NULL, name TEXT NOT NULL,
  yield_quantity NUMERIC(14,3) NOT NULL DEFAULT 1, instructions TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS app_production_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  recipe_id UUID REFERENCES app_recipes(id) ON DELETE SET NULL, product_id UUID REFERENCES app_products(id) ON DELETE SET NULL,
  planned_quantity NUMERIC(14,3) NOT NULL, produced_quantity NUMERIC(14,3),
  waste_quantity NUMERIC(14,3) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','in_progress','completed','cancelled')),
  notes TEXT, actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS app_financial_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  entry_type TEXT NOT NULL CHECK(entry_type IN ('income','expense')), category TEXT NOT NULL,
  description TEXT NOT NULL, amount NUMERIC(14,2) NOT NULL CHECK(amount>0),
  payment_method TEXT, reference TEXT, due_date DATE, paid_at TIMESTAMPTZ,
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS app_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID REFERENCES app_users(id) ON DELETE CASCADE, type TEXT NOT NULL,
  title TEXT NOT NULL, message TEXT NOT NULL, read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS app_backup_log (
  id BIGSERIAL PRIMARY KEY, business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK(status IN ('started','completed','failed')),
  storage_reference TEXT, details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS app_products_business_name_idx ON app_products(business_id,name);
CREATE INDEX IF NOT EXISTS app_inventory_business_created_idx ON app_inventory_movements(business_id,created_at DESC);
CREATE INDEX IF NOT EXISTS app_sales_business_created_idx ON app_sales(business_id,created_at DESC);
CREATE INDEX IF NOT EXISTS app_financial_business_created_idx ON app_financial_entries(business_id,created_at DESC);
CREATE INDEX IF NOT EXISTS app_notifications_user_created_idx ON app_notifications(user_id,created_at DESC);

-- No se crea una panadería automáticamente. La cuenta principal debe registrarla desde Administración.

INSERT INTO schema_migrations(version) VALUES('002_erp_modules')
ON CONFLICT(version) DO NOTHING;
COMMIT;
