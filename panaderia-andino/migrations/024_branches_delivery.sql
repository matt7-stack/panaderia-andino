-- 024: operational branches and delivery orders.
-- Additive migration: preserves existing business and ERP records.
BEGIN;

CREATE TABLE IF NOT EXISTS app_branches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  phone TEXT,
  manager_name TEXT,
  is_main BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT app_branches_business_id_id_key UNIQUE(business_id,id),
  CONSTRAINT app_branches_business_code_key UNIQUE(business_id,code),
  CONSTRAINT app_branches_code_check CHECK(code ~ '^[A-Z0-9-]{1,20}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS app_branches_one_main_per_business
  ON app_branches(business_id) WHERE is_main=TRUE;
CREATE INDEX IF NOT EXISTS app_branches_business_active_idx
  ON app_branches(business_id,active,is_main);

-- Every existing business receives one principal branch without changing its existing ERP records.
INSERT INTO app_branches(business_id,code,name,is_main,active)
SELECT b.id,'CENTRAL','Casa central',TRUE,TRUE
FROM businesses b
WHERE NOT EXISTS (
  SELECT 1 FROM app_branches x WHERE x.business_id=b.id AND x.is_main=TRUE
)
ON CONFLICT(business_id,code) DO NOTHING;

CREATE TABLE IF NOT EXISTS app_delivery_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  branch_id UUID NOT NULL,
  customer_id UUID,
  order_number TEXT NOT NULL,
  recipient_name TEXT NOT NULL,
  phone TEXT,
  address TEXT NOT NULL,
  scheduled_for TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','confirmed','preparing','ready','out_for_delivery','delivered','cancelled')),
  subtotal NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(subtotal>=0),
  delivery_fee NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(delivery_fee>=0),
  discount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(discount>=0),
  total NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(total>=0),
  payment_method TEXT,
  notes TEXT,
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  delivered_at TIMESTAMPTZ,
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT app_delivery_orders_business_id_id_key UNIQUE(business_id,id),
  CONSTRAINT app_delivery_orders_business_number_key UNIQUE(business_id,order_number),
  CONSTRAINT app_delivery_orders_business_idempotency_key UNIQUE(business_id,idempotency_key),
  CONSTRAINT app_delivery_orders_business_branch_fk
    FOREIGN KEY(business_id,branch_id) REFERENCES app_branches(business_id,id) ON DELETE RESTRICT,
  CONSTRAINT app_delivery_orders_business_customer_fk
    FOREIGN KEY(business_id,customer_id) REFERENCES app_customers(business_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS app_delivery_orders_business_status_created_idx
  ON app_delivery_orders(business_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS app_delivery_orders_business_branch_created_idx
  ON app_delivery_orders(business_id,branch_id,created_at DESC);
CREATE INDEX IF NOT EXISTS app_delivery_orders_business_scheduled_idx
  ON app_delivery_orders(business_id,scheduled_for) WHERE scheduled_for IS NOT NULL;

CREATE TABLE IF NOT EXISTS app_delivery_order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL,
  order_id UUID NOT NULL,
  product_id UUID,
  description TEXT NOT NULL,
  quantity NUMERIC(14,3) NOT NULL CHECK(quantity>0),
  unit_price NUMERIC(14,2) NOT NULL CHECK(unit_price>=0),
  line_total NUMERIC(14,2) NOT NULL CHECK(line_total>=0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT app_delivery_order_items_business_order_fk
    FOREIGN KEY(business_id,order_id) REFERENCES app_delivery_orders(business_id,id) ON DELETE RESTRICT,
  CONSTRAINT app_delivery_order_items_business_product_fk
    FOREIGN KEY(business_id,product_id) REFERENCES app_products(business_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS app_delivery_order_items_business_order_idx
  ON app_delivery_order_items(business_id,order_id);

CREATE TABLE IF NOT EXISTS app_delivery_events (
  id BIGSERIAL PRIMARY KEY,
  business_id UUID NOT NULL,
  order_id UUID NOT NULL,
  actor_user_id UUID REFERENCES app_users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT app_delivery_events_business_order_fk
    FOREIGN KEY(business_id,order_id) REFERENCES app_delivery_orders(business_id,id) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS app_delivery_events_business_order_created_idx
  ON app_delivery_events(business_id,order_id,created_at DESC);

UPDATE app_module_catalog
SET active=TRUE,implemented=TRUE,updated_at=NOW()
WHERE module_key IN ('branches','delivery');

INSERT INTO schema_migrations(version)
VALUES('024_branches_delivery')
ON CONFLICT(version) DO NOTHING;

COMMIT;
