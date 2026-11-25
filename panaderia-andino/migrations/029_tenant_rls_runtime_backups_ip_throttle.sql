-- 029: runtime least-privilege role, tenant RLS, remote backups and IP login throttling.
BEGIN;

CREATE TABLE IF NOT EXISTS app_business_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  payload jsonb NOT NULL,
  checksum text NOT NULL,
  payload_bytes integer NOT NULL CHECK (payload_bytes >= 0 AND payload_bytes <= 1000000),
  label text NOT NULL DEFAULT 'Respaldo manual',
  created_at timestamptz NOT NULL DEFAULT NOW(),
  restored_at timestamptz,
  restored_by uuid REFERENCES app_users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS app_business_backups_business_created_idx
  ON app_business_backups(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app_login_ip_attempts (
  ip_hash text PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS app_login_ip_attempts_locked_idx
  ON app_login_ip_attempts(locked_until) WHERE locked_until IS NOT NULL;

CREATE OR REPLACE FUNCTION public.app_current_business_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.business_id', true), '')::uuid,
    (SELECT u.business_id FROM public.app_users u
      WHERE u.id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND u.active = TRUE LIMIT 1),
    (SELECT u.business_id FROM public.app_users u
      WHERE lower(u.email) = lower(NULLIF(current_setting('app.login_email', true), ''))
        AND u.active = TRUE LIMIT 1)
  )
$$;

CREATE OR REPLACE FUNCTION public.app_is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.is_platform_admin', true), '')::boolean, FALSE)
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.id = NULLIF(current_setting('app.user_id', true), '')::uuid
        AND u.active = TRUE AND u.is_platform_admin = TRUE
    )
$$;

CREATE OR REPLACE FUNCTION public.app_is_bootstrap()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.bootstrap_mode', true), '')::boolean, FALSE)
$$;

DO $$
DECLARE
  item record;
  v_table_name text;
BEGIN
  FOR item IN
    SELECT c.table_name
    FROM information_schema.columns c
    WHERE c.table_schema='public' AND c.column_name='business_id'
      AND c.table_name <> 'app_users'
  LOOP
    v_table_name := item.table_name;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table_name);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', v_table_name);
    EXECUTE format('DROP POLICY IF EXISTS mattsystem_tenant_select ON public.%I', v_table_name);
    EXECUTE format('DROP POLICY IF EXISTS mattsystem_tenant_insert ON public.%I', v_table_name);
    EXECUTE format('DROP POLICY IF EXISTS mattsystem_tenant_update ON public.%I', v_table_name);
    EXECUTE format('DROP POLICY IF EXISTS mattsystem_tenant_delete ON public.%I', v_table_name);

    IF v_table_name IN ('app_state','app_business_config','app_licenses') THEN
      EXECUTE format(
        'CREATE POLICY mattsystem_tenant_select ON public.%I FOR SELECT USING (
          public.app_is_platform_admin()
          OR business_id = public.app_current_business_id()
          OR business_id = NULLIF(current_setting(''app.public_catalog_business_id'', true), '''')::uuid
        )', v_table_name);
    ELSE
      EXECUTE format(
        'CREATE POLICY mattsystem_tenant_select ON public.%I FOR SELECT USING (
          public.app_is_platform_admin() OR business_id = public.app_current_business_id()
        )', v_table_name);
    END IF;

    IF v_table_name = 'app_audit_logs' THEN
      EXECUTE format(
        'CREATE POLICY mattsystem_tenant_insert ON public.%I FOR INSERT WITH CHECK (
          business_id IS NULL OR public.app_is_platform_admin() OR business_id = public.app_current_business_id()
        )', v_table_name);
    ELSE
      EXECUTE format(
        'CREATE POLICY mattsystem_tenant_insert ON public.%I FOR INSERT WITH CHECK (
          public.app_is_platform_admin() OR business_id = public.app_current_business_id()
        )', v_table_name);
    END IF;
    EXECUTE format(
      'CREATE POLICY mattsystem_tenant_update ON public.%I FOR UPDATE USING (
        public.app_is_platform_admin() OR business_id = public.app_current_business_id()
      ) WITH CHECK (
        public.app_is_platform_admin() OR business_id = public.app_current_business_id()
      )', v_table_name);
    EXECUTE format(
      'CREATE POLICY mattsystem_tenant_delete ON public.%I FOR DELETE USING (
        public.app_is_platform_admin() OR business_id = public.app_current_business_id()
      )', v_table_name);
  END LOOP;
END $$;

-- Business directory: a tenant sees only its own record; public catalogue reads
-- are explicitly limited to the business ID resolved by the public catalogue route.
ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.businesses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mattsystem_business_select ON public.businesses;
DROP POLICY IF EXISTS mattsystem_business_insert ON public.businesses;
DROP POLICY IF EXISTS mattsystem_business_update ON public.businesses;
DROP POLICY IF EXISTS mattsystem_business_delete ON public.businesses;
CREATE POLICY mattsystem_business_select ON public.businesses FOR SELECT USING (
  public.app_is_platform_admin()
  OR id = public.app_current_business_id()
  OR id = NULLIF(current_setting('app.public_catalog_business_id', true), '')::uuid
);
CREATE POLICY mattsystem_business_insert ON public.businesses FOR INSERT WITH CHECK (public.app_is_platform_admin());
CREATE POLICY mattsystem_business_update ON public.businesses FOR UPDATE USING (public.app_is_platform_admin()) WITH CHECK (public.app_is_platform_admin());
CREATE POLICY mattsystem_business_delete ON public.businesses FOR DELETE USING (public.app_is_platform_admin());

-- User rows are restricted to the signed-in user, the user's business, or the
-- exact email currently being checked by the server-side login flow.
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mattsystem_users_select ON public.app_users;
DROP POLICY IF EXISTS mattsystem_users_insert ON public.app_users;
DROP POLICY IF EXISTS mattsystem_users_update ON public.app_users;
DROP POLICY IF EXISTS mattsystem_users_delete ON public.app_users;
CREATE POLICY mattsystem_users_select ON public.app_users FOR SELECT USING (
  public.app_is_platform_admin()
  OR id = NULLIF(current_setting('app.user_id', true), '')::uuid
  OR business_id = public.app_current_business_id()
  OR lower(email) = lower(NULLIF(current_setting('app.login_email', true), ''))
  OR (public.app_is_bootstrap() AND is_platform_admin = TRUE)
);
CREATE POLICY mattsystem_users_insert ON public.app_users FOR INSERT WITH CHECK (
  public.app_is_platform_admin()
  OR (public.app_is_bootstrap() AND is_platform_admin = TRUE AND business_id IS NULL)
);
CREATE POLICY mattsystem_users_update ON public.app_users FOR UPDATE USING (public.app_is_platform_admin()) WITH CHECK (public.app_is_platform_admin());
CREATE POLICY mattsystem_users_delete ON public.app_users FOR DELETE USING (public.app_is_platform_admin());

-- Tables scoped through a parent foreign key rather than a direct business_id.
ALTER TABLE public.app_support_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_support_replies FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mattsystem_support_replies_select ON public.app_support_replies;
DROP POLICY IF EXISTS mattsystem_support_replies_insert ON public.app_support_replies;
DROP POLICY IF EXISTS mattsystem_support_replies_update ON public.app_support_replies;
DROP POLICY IF EXISTS mattsystem_support_replies_delete ON public.app_support_replies;
CREATE POLICY mattsystem_support_replies_select ON public.app_support_replies FOR SELECT USING (
  public.app_is_platform_admin() OR EXISTS (
    SELECT 1 FROM public.app_support_tickets t
    WHERE t.id = ticket_id AND t.business_id = public.app_current_business_id()
  )
);
CREATE POLICY mattsystem_support_replies_insert ON public.app_support_replies FOR INSERT WITH CHECK (
  public.app_is_platform_admin() OR (
    author_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM public.app_support_tickets t
      WHERE t.id = ticket_id AND t.business_id = public.app_current_business_id())
  )
);
CREATE POLICY mattsystem_support_replies_update ON public.app_support_replies FOR UPDATE USING (public.app_is_platform_admin()) WITH CHECK (public.app_is_platform_admin());
CREATE POLICY mattsystem_support_replies_delete ON public.app_support_replies FOR DELETE USING (public.app_is_platform_admin());

ALTER TABLE public.app_license_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_license_payments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mattsystem_license_payments_select ON public.app_license_payments;
DROP POLICY IF EXISTS mattsystem_license_payments_insert ON public.app_license_payments;
DROP POLICY IF EXISTS mattsystem_license_payments_update ON public.app_license_payments;
DROP POLICY IF EXISTS mattsystem_license_payments_delete ON public.app_license_payments;
CREATE POLICY mattsystem_license_payments_select ON public.app_license_payments FOR SELECT USING (
  public.app_is_platform_admin() OR EXISTS (
    SELECT 1 FROM public.app_licenses l
    WHERE l.id = license_id AND l.business_id = public.app_current_business_id()
  )
);
CREATE POLICY mattsystem_license_payments_insert ON public.app_license_payments FOR INSERT WITH CHECK (public.app_is_platform_admin());
CREATE POLICY mattsystem_license_payments_update ON public.app_license_payments FOR UPDATE USING (public.app_is_platform_admin()) WITH CHECK (public.app_is_platform_admin());
CREATE POLICY mattsystem_license_payments_delete ON public.app_license_payments FOR DELETE USING (public.app_is_platform_admin());

-- Per-user settings and password-reset tokens.
ALTER TABLE public.app_notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_notification_preferences FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mattsystem_notification_preferences_all ON public.app_notification_preferences;
CREATE POLICY mattsystem_notification_preferences_all ON public.app_notification_preferences FOR ALL USING (
  public.app_is_platform_admin() OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
) WITH CHECK (
  public.app_is_platform_admin() OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
);

ALTER TABLE public.admin_password_resets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_password_resets FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mattsystem_password_resets_all ON public.admin_password_resets;
CREATE POLICY mattsystem_password_resets_all ON public.admin_password_resets FOR ALL USING (
  public.app_is_platform_admin() OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
) WITH CHECK (
  public.app_is_platform_admin() OR user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
);

-- Global control tables: public reads only where the client needs them; all writes
-- and platform financial/security records remain administrator-only.
DO $$
DECLARE
  t text;
  public_read text[] := ARRAY['app_module_catalog','app_industry_templates','app_platform_settings','app_platform_maintenance'];
  admin_only text[] := ARRAY[
    'app_admin_finance_entries','app_admin_private_notes','app_commercial_settings',
    'app_license_plan_settings','app_license_settings','app_platform_expenses',
    'app_trial_claims','schema_migrations'
  ];
BEGIN
  FOREACH t IN ARRAY public_read LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
      EXECUTE format('DROP POLICY IF EXISTS mattsystem_public_read ON public.%I',t);
      EXECUTE format('DROP POLICY IF EXISTS mattsystem_admin_write ON public.%I',t);
      EXECUTE format('CREATE POLICY mattsystem_public_read ON public.%I FOR SELECT USING (TRUE)',t);
      EXECUTE format('CREATE POLICY mattsystem_admin_write ON public.%I FOR ALL USING (public.app_is_platform_admin()) WITH CHECK (public.app_is_platform_admin())',t);
    END IF;
  END LOOP;
  FOREACH t IN ARRAY admin_only LOOP
    IF to_regclass('public.'||t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY',t);
      EXECUTE format('DROP POLICY IF EXISTS mattsystem_admin_only ON public.%I',t);
      EXECUTE format('CREATE POLICY mattsystem_admin_only ON public.%I FOR ALL USING (public.app_is_platform_admin()) WITH CHECK (public.app_is_platform_admin())',t);
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.app_admin_setup_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_admin_setup_tokens FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mattsystem_setup_tokens ON public.app_admin_setup_tokens;
CREATE POLICY mattsystem_setup_tokens ON public.app_admin_setup_tokens FOR ALL USING (
  public.app_is_platform_admin() OR public.app_is_bootstrap()
) WITH CHECK (
  public.app_is_platform_admin() OR public.app_is_bootstrap()
);

GRANT EXECUTE ON FUNCTION public.app_current_business_id() TO mattsystem_runtime;
GRANT EXECUTE ON FUNCTION public.app_is_platform_admin() TO mattsystem_runtime;
GRANT EXECUTE ON FUNCTION public.app_is_bootstrap() TO mattsystem_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO mattsystem_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mattsystem_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE panaderia_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mattsystem_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE panaderia_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO mattsystem_runtime;

INSERT INTO schema_migrations(version)
VALUES ('029_tenant_rls_runtime_backups_ip_throttle')
ON CONFLICT(version) DO NOTHING;

COMMIT;
