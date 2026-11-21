BEGIN;

-- Rol de ejecución sin BYPASSRLS. La conexión privilegiada solo lo asume dentro
-- de transacciones autenticadas, después de validar el HMAC del tenant.
DO $role_setup$
DECLARE role_is_unsafe boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mattsystem_app') THEN
    CREATE ROLE mattsystem_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  ELSE
    SELECT rolsuper OR rolbypassrls INTO role_is_unsafe
    FROM pg_roles WHERE rolname = 'mattsystem_app';
    IF COALESCE(role_is_unsafe, TRUE) THEN
      RAISE EXCEPTION 'mattsystem_app must be NOSUPERUSER and NOBYPASSRLS';
    END IF;
  END IF;
END
$role_setup$;
GRANT USAGE ON SCHEMA public TO mattsystem_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mattsystem_app;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO mattsystem_app;
ALTER DEFAULT PRIVILEGES FOR ROLE panaderia_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mattsystem_app;
ALTER DEFAULT PRIVILEGES FOR ROLE panaderia_owner IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO mattsystem_app;
GRANT mattsystem_app TO panaderia_owner WITH INHERIT FALSE, SET TRUE;

-- Contexto de seguridad establecido por la API dentro de cada transacción.
CREATE OR REPLACE FUNCTION public.app_ctx_business_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.business_id', true), '')::uuid
$$;
CREATE OR REPLACE FUNCTION public.app_ctx_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;
CREATE OR REPLACE FUNCTION public.app_ctx_is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.is_platform_admin', true), '')::boolean, false)
$$;

REVOKE ALL ON FUNCTION public.app_ctx_business_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_ctx_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_ctx_is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_ctx_business_id() TO mattsystem_app;
GRANT EXECUTE ON FUNCTION public.app_ctx_user_id() TO mattsystem_app;
GRANT EXECUTE ON FUNCTION public.app_ctx_is_platform_admin() TO mattsystem_app;

-- Tablas con datos operativos: no pueden consultarse ni modificarse fuera del negocio autenticado.
DO $migration$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'app_audit_logs','app_backup_log','app_cash_movements','app_cash_sessions',
    'app_customers','app_financial_entries','app_inventory_movements',
    'app_production_batches','app_products','app_purchase_items','app_purchases',
    'app_recipe_ingredients','app_recipes','app_sale_items','app_sales',
    'app_state','app_suppliers','app_support_tickets','app_trash'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS mattsystem_tenant_isolation ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY mattsystem_tenant_isolation ON public.%I FOR ALL TO mattsystem_app USING (public.app_ctx_is_platform_admin() OR business_id = public.app_ctx_business_id()) WITH CHECK (public.app_ctx_is_platform_admin() OR business_id = public.app_ctx_business_id())',
      table_name
    );
  END LOOP;
END
$migration$;

-- Notificaciones y preferencias se limitan además al usuario autenticado.
ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_notifications FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mattsystem_user_tenant_isolation ON public.app_notifications;
CREATE POLICY mattsystem_user_tenant_isolation ON public.app_notifications
  FOR ALL TO mattsystem_app
  USING (
    public.app_ctx_is_platform_admin()
    OR user_id = public.app_ctx_user_id()
    OR (business_id IS NOT NULL AND business_id = public.app_ctx_business_id())
  )
  WITH CHECK (
    public.app_ctx_is_platform_admin()
    OR user_id = public.app_ctx_user_id()
    OR (business_id IS NOT NULL AND business_id = public.app_ctx_business_id())
  );

ALTER TABLE public.app_notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_notification_preferences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mattsystem_user_isolation ON public.app_notification_preferences;
CREATE POLICY mattsystem_user_isolation ON public.app_notification_preferences
  FOR ALL TO mattsystem_app
  USING (public.app_ctx_is_platform_admin() OR user_id = public.app_ctx_user_id())
  WITH CHECK (public.app_ctx_is_platform_admin() OR user_id = public.app_ctx_user_id());

-- Las respuestas heredan el aislamiento del ticket al que pertenecen.
ALTER TABLE public.app_support_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_support_replies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mattsystem_ticket_isolation ON public.app_support_replies;
CREATE POLICY mattsystem_ticket_isolation ON public.app_support_replies
  FOR ALL TO mattsystem_app
  USING (
    public.app_ctx_is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.app_support_tickets t
      WHERE t.id = ticket_id AND t.business_id = public.app_ctx_business_id()
    )
  )
  WITH CHECK (
    public.app_ctx_is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.app_support_tickets t
      WHERE t.id = ticket_id AND t.business_id = public.app_ctx_business_id()
    )
  );

-- Los pagos de licencia se aíslan por el negocio dueño de la licencia.
ALTER TABLE public.app_license_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_license_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mattsystem_license_payment_isolation ON public.app_license_payments;
CREATE POLICY mattsystem_license_payment_isolation ON public.app_license_payments
  FOR ALL TO mattsystem_app
  USING (
    public.app_ctx_is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.app_licenses l
      WHERE l.id = license_id AND l.business_id = public.app_ctx_business_id()
    )
  )
  WITH CHECK (
    public.app_ctx_is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.app_licenses l
      WHERE l.id = license_id AND l.business_id = public.app_ctx_business_id()
    )
  );

-- El catálogo público devuelve únicamente campos permitidos; nunca expone app_state completo.
CREATE OR REPLACE FUNCTION public.app_public_catalog(p_business_id uuid)
RETURNS TABLE (
  business_id uuid,
  business_name text,
  business_address text,
  business_phone text,
  products jsonb,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
  SELECT
    b.id,
    b.name,
    b.address,
    b.phone,
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', COALESCE(item->>'id', ''),
        'name', left(COALESCE(item->>'name', ''), 100),
        'category', left(COALESCE(item->>'category', ''), 60),
        'description', left(COALESCE(item->>'description', ''), 300),
        'price', CASE
          WHEN COALESCE(item->>'price', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
          THEN GREATEST(0, (item->>'price')::numeric)
          ELSE 0
        END,
        'available', CASE
          WHEN jsonb_typeof(item->'available') = 'boolean' THEN (item->>'available')::boolean
          WHEN COALESCE(item->>'stock', '') ~ '^-?[0-9]+(\.[0-9]+)?$' THEN (item->>'stock')::numeric > 0
          ELSE false
        END
      ))
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(st.data->'products') = 'array'
          THEN st.data->'products' ELSE '[]'::jsonb END
      ) AS products(item)
      WHERE COALESCE(item->>'active', 'true') <> 'false'
        AND COALESCE(item->>'name', '') <> ''
    ), '[]'::jsonb),
    st.updated_at
  FROM public.businesses b
  LEFT JOIN public.app_state st ON st.business_id = b.id
  WHERE b.id = p_business_id AND b.active = true
  LIMIT 1
$function$;

REVOKE ALL ON FUNCTION public.app_public_catalog(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_public_catalog(uuid) TO mattsystem_app;

INSERT INTO public.schema_migrations(version)
VALUES ('008_tenant_rls_enforcement')
ON CONFLICT (version) DO NOTHING;

COMMIT;
