-- 008: configurable business industries, modular packages and commercial quotes.
-- Additive migration. Existing businesses keep all current modules enabled.
BEGIN;

CREATE TABLE IF NOT EXISTS app_module_catalog (
  module_key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'operacion',
  monthly_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (monthly_price >= 0),
  setup_price NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (setup_price >= 0),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 100,
  updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_module_catalog(module_key,title,description,category,sort_order) VALUES
('dashboard','Panel principal','Indicadores y resumen del negocio','base',10),
('movements','Ingresos y gastos','Registro y seguimiento financiero','finanzas',20),
('invoices','Notas y comprobantes internos','Notas, ventas registradas y cobros','ventas',30),
('products','Productos y costos','Catálogo, precios y costos','inventario',40),
('sales','Ventas','Registro e historial de ventas','ventas',50),
('inventory','Inventario','Existencias, entradas, salidas y mermas','inventario',60),
('customers','Clientes','Fichas y datos de clientes','relaciones',70),
('suppliers','Proveedores','Fichas y datos de proveedores','relaciones',80),
('purchases','Compras','Compras y abastecimiento','compras',90),
('recipes','Recetas','Fórmulas e ingredientes','produccion',100),
('production','Producción','Órdenes y lotes de producción','produccion',110),
('cash','Caja','Apertura, cierre y movimientos de caja','finanzas',120),
('reports','Informes avanzados','Reportes y exportaciones','analitica',130),
('employees','Empleados y pagos','Personal, pagos y anticipos','personal',140),
('users','Usuarios y permisos','Administración de usuarios del negocio','seguridad',150),
('branches','Sucursales','Gestión de más de una sucursal','expansion',160),
('delivery','Pedidos y entregas','Pedidos, reparto y entregas','logistica',170)
ON CONFLICT(module_key) DO UPDATE SET
 title=EXCLUDED.title, description=EXCLUDED.description, category=EXCLUDED.category, sort_order=EXCLUDED.sort_order;

CREATE TABLE IF NOT EXISTS app_industry_templates (
  industry_key TEXT NOT NULL CHECK (industry_key IN ('panaderias','minimercados','tiendas','restaurantes','comercios_generales','distribuidoras')),
  module_key TEXT NOT NULL REFERENCES app_module_catalog(module_key) ON DELETE CASCADE,
  enabled_by_default BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY(industry_key,module_key)
);

INSERT INTO app_industry_templates(industry_key,module_key,enabled_by_default) VALUES
('panaderias','dashboard',TRUE),('panaderias','movements',TRUE),('panaderias','invoices',TRUE),('panaderias','products',TRUE),('panaderias','sales',TRUE),('panaderias','inventory',TRUE),('panaderias','customers',TRUE),('panaderias','suppliers',TRUE),('panaderias','purchases',TRUE),('panaderias','recipes',TRUE),('panaderias','production',TRUE),('panaderias','cash',TRUE),('panaderias','reports',TRUE),('panaderias','employees',TRUE),('panaderias','users',TRUE),('panaderias','branches',FALSE),('panaderias','delivery',FALSE),
('minimercados','dashboard',TRUE),('minimercados','movements',TRUE),('minimercados','invoices',TRUE),('minimercados','products',TRUE),('minimercados','sales',TRUE),('minimercados','inventory',TRUE),('minimercados','customers',TRUE),('minimercados','suppliers',TRUE),('minimercados','purchases',TRUE),('minimercados','recipes',FALSE),('minimercados','production',FALSE),('minimercados','cash',TRUE),('minimercados','reports',TRUE),('minimercados','employees',TRUE),('minimercados','users',TRUE),('minimercados','branches',FALSE),('minimercados','delivery',FALSE),
('tiendas','dashboard',TRUE),('tiendas','movements',TRUE),('tiendas','invoices',TRUE),('tiendas','products',TRUE),('tiendas','sales',TRUE),('tiendas','inventory',TRUE),('tiendas','customers',TRUE),('tiendas','suppliers',FALSE),('tiendas','purchases',TRUE),('tiendas','recipes',FALSE),('tiendas','production',FALSE),('tiendas','cash',TRUE),('tiendas','reports',TRUE),('tiendas','employees',TRUE),('tiendas','users',TRUE),('tiendas','branches',FALSE),('tiendas','delivery',FALSE),
('restaurantes','dashboard',TRUE),('restaurantes','movements',TRUE),('restaurantes','invoices',TRUE),('restaurantes','products',TRUE),('restaurantes','sales',TRUE),('restaurantes','inventory',TRUE),('restaurantes','customers',TRUE),('restaurantes','suppliers',TRUE),('restaurantes','purchases',TRUE),('restaurantes','recipes',TRUE),('restaurantes','production',TRUE),('restaurantes','cash',TRUE),('restaurantes','reports',TRUE),('restaurantes','employees',TRUE),('restaurantes','users',TRUE),('restaurantes','branches',FALSE),('restaurantes','delivery',TRUE),
('comercios_generales','dashboard',TRUE),('comercios_generales','movements',TRUE),('comercios_generales','invoices',TRUE),('comercios_generales','products',TRUE),('comercios_generales','sales',TRUE),('comercios_generales','inventory',TRUE),('comercios_generales','customers',TRUE),('comercios_generales','suppliers',TRUE),('comercios_generales','purchases',TRUE),('comercios_generales','recipes',FALSE),('comercios_generales','production',FALSE),('comercios_generales','cash',TRUE),('comercios_generales','reports',TRUE),('comercios_generales','employees',TRUE),('comercios_generales','users',TRUE),('comercios_generales','branches',FALSE),('comercios_generales','delivery',FALSE),
('distribuidoras','dashboard',TRUE),('distribuidoras','movements',TRUE),('distribuidoras','invoices',TRUE),('distribuidoras','products',TRUE),('distribuidoras','sales',TRUE),('distribuidoras','inventory',TRUE),('distribuidoras','customers',TRUE),('distribuidoras','suppliers',TRUE),('distribuidoras','purchases',TRUE),('distribuidoras','recipes',FALSE),('distribuidoras','production',FALSE),('distribuidoras','cash',TRUE),('distribuidoras','reports',TRUE),('distribuidoras','employees',TRUE),('distribuidoras','users',TRUE),('distribuidoras','branches',TRUE),('distribuidoras','delivery',TRUE)
ON CONFLICT(industry_key,module_key) DO UPDATE SET enabled_by_default=EXCLUDED.enabled_by_default;

CREATE TABLE IF NOT EXISTS app_business_config (
  business_id UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  industry_key TEXT NOT NULL DEFAULT 'comercios_generales' CHECK (industry_key IN ('panaderias','minimercados','tiendas','restaurantes','comercios_generales','distribuidoras')),
  config_mode TEXT NOT NULL DEFAULT 'legacy' CHECK (config_mode IN ('template','custom','hybrid','legacy')),
  modules JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(modules)='array'),
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_business_config(business_id,industry_key,config_mode,modules)
SELECT b.id,'comercios_generales','legacy',
       COALESCE((SELECT jsonb_agg(m.module_key ORDER BY m.sort_order) FROM app_module_catalog m WHERE m.active), '[]'::jsonb)
FROM businesses b
ON CONFLICT(business_id) DO NOTHING;

ALTER TABLE app_licenses ADD COLUMN IF NOT EXISTS modules JSONB;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='app_licenses_modules_array_check') THEN
    ALTER TABLE app_licenses ADD CONSTRAINT app_licenses_modules_array_check
      CHECK (modules IS NULL OR jsonb_typeof(modules)='array');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS app_quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  prospect_name TEXT NOT NULL,
  prospect_email TEXT NOT NULL DEFAULT '',
  industry_key TEXT NOT NULL CHECK (industry_key IN ('panaderias','minimercados','tiendas','restaurantes','comercios_generales','distribuidoras')),
  config_mode TEXT NOT NULL CHECK (config_mode IN ('template','custom','hybrid')),
  modules JSONB NOT NULL CHECK (jsonb_typeof(modules)='array'),
  plan_type TEXT NOT NULL DEFAULT 'monthly' CHECK (plan_type IN ('monthly','annual','permanent','full_sale')),
  setup_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(setup_amount>=0),
  monthly_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(monthly_amount>=0),
  annual_amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK(annual_amount>=0),
  currency TEXT NOT NULL DEFAULT 'PYG',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','rejected','expired','converted')),
  valid_until DATE,
  notes TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS app_quotations_status_created_idx ON app_quotations(status,created_at DESC);

CREATE TABLE IF NOT EXISTS app_module_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  module_key TEXT NOT NULL REFERENCES app_module_catalog(module_key) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','quoted','approved','rejected')),
  requested_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  quotation_id UUID REFERENCES app_quotations(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(business_id,module_key,status)
);
CREATE INDEX IF NOT EXISTS app_module_requests_business_idx ON app_module_requests(business_id,status,created_at DESC);

INSERT INTO schema_migrations(version) VALUES('008_business_modules_commercial')
ON CONFLICT(version) DO NOTHING;
COMMIT;