-- 033: endurecer inventario, precios e intentos de acceso por IP.
BEGIN;

-- La API ya firma el contexto de ip_hash dentro de cada transacción de login.
ALTER TABLE public.app_login_ip_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_login_ip_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_login_ip_attempts_scope ON public.app_login_ip_attempts;
DROP POLICY IF EXISTS mattsystem_login_ip_attempts_scope ON public.app_login_ip_attempts;
CREATE POLICY app_login_ip_attempts_scope ON public.app_login_ip_attempts
  FOR ALL TO PUBLIC
  USING (ip_hash = NULLIF(current_setting('app.ip_hash', true), ''))
  WITH CHECK (ip_hash = NULLIF(current_setting('app.ip_hash', true), ''));

-- La API valida el stock, y la base añade una segunda barrera ante cualquier ruta futura.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.app_products'::regclass
      AND conname = 'app_products_stock_nonnegative'
  ) THEN
    ALTER TABLE public.app_products
      ADD CONSTRAINT app_products_stock_nonnegative CHECK (stock >= 0) NOT VALID;
  END IF;
END
$$;
ALTER TABLE public.app_products VALIDATE CONSTRAINT app_products_stock_nonnegative;

INSERT INTO public.schema_migrations(version)
VALUES ('033_security_price_stock_and_ip_rls')
ON CONFLICT (version) DO NOTHING;

COMMIT;
