-- 034: firmar todo el contexto de tenant y autenticación con HMAC.
-- Ningún GUC personalizado se considera confiable sin validar su firma.

BEGIN;

CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;

CREATE TABLE IF NOT EXISTS app_private.tenant_context_secret (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton = true),
  secret_hex text NOT NULL CHECK (secret_hex ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON app_private.tenant_context_secret FROM PUBLIC;

CREATE OR REPLACE FUNCTION app_private.tenant_context_is_valid()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM app_private.tenant_context_secret s
    WHERE s.singleton = true
      AND encode(
        public.hmac(
          convert_to(
            COALESCE(current_setting('app.business_id', true), '') || '|' ||
            COALESCE(current_setting('app.user_id', true), '') || '|' ||
            COALESCE(current_setting('app.is_platform_admin', true), 'false') || '|' ||
            COALESCE(current_setting('app.login_email', true), '') || '|' ||
            COALESCE(current_setting('app.ip_hash', true), '') || '|' ||
            COALESCE(current_setting('app.bootstrap_mode', true), 'false') || '|' ||
            COALESCE(current_setting('app.public_catalog_business_id', true), ''),
            'UTF8'
          ),
          decode(s.secret_hex, 'hex'),
          'sha256'
        ),
        'hex'
      ) = COALESCE(current_setting('app.context_signature', true), '')
  )
$function$;
REVOKE ALL ON FUNCTION app_private.tenant_context_is_valid() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.app_context_is_valid()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $function$
  SELECT app_private.tenant_context_is_valid()
$function$;

CREATE OR REPLACE FUNCTION public.app_context_user_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $function$
  SELECT CASE WHEN app_private.tenant_context_is_valid()
    THEN NULLIF(current_setting('app.user_id', true), '')::uuid
    ELSE NULL::uuid END
$function$;

CREATE OR REPLACE FUNCTION public.app_context_business_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $function$
  SELECT CASE WHEN app_private.tenant_context_is_valid()
    THEN NULLIF(current_setting('app.business_id', true), '')::uuid
    ELSE NULL::uuid END
$function$;

CREATE OR REPLACE FUNCTION public.app_context_public_catalog_business_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $function$
  SELECT CASE WHEN app_private.tenant_context_is_valid()
    THEN NULLIF(current_setting('app.public_catalog_business_id', true), '')::uuid
    ELSE NULL::uuid END
$function$;

CREATE OR REPLACE FUNCTION public.app_context_login_email()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $function$
  SELECT CASE WHEN app_private.tenant_context_is_valid()
    THEN NULLIF(current_setting('app.login_email', true), '')
    ELSE NULL::text END
$function$;

CREATE OR REPLACE FUNCTION public.app_context_ip_hash()
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $function$
  SELECT CASE WHEN app_private.tenant_context_is_valid()
    THEN NULLIF(current_setting('app.ip_hash', true), '')
    ELSE NULL::text END
$function$;

CREATE OR REPLACE FUNCTION public.app_context_bootstrap()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $function$
  SELECT app_private.tenant_context_is_valid()
    AND COALESCE(NULLIF(current_setting('app.bootstrap_mode', true), '')::boolean, false)
$function$;

CREATE OR REPLACE FUNCTION public.app_context_is_platform_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $function$
  SELECT app_private.tenant_context_is_valid()
    AND COALESCE(NULLIF(current_setting('app.is_platform_admin', true), '')::boolean, false)
$function$;

CREATE OR REPLACE FUNCTION public.app_current_business_id()
RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $function$
  SELECT CASE WHEN app_private.tenant_context_is_valid() THEN COALESCE(
    public.app_context_business_id(),
    (SELECT u.business_id FROM public.app_users u
      WHERE u.id = public.app_context_user_id() AND u.active = true LIMIT 1),
    (SELECT u.business_id FROM public.app_users u
      WHERE lower(u.email) = lower(public.app_context_login_email()) AND u.active = true LIMIT 1)
  ) ELSE NULL::uuid END
$function$;

CREATE OR REPLACE FUNCTION public.app_is_platform_admin()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $function$
  SELECT public.app_context_is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.app_users u
      WHERE u.id = public.app_context_user_id()
        AND u.active = true
        AND u.is_platform_admin = true
    )
$function$;

CREATE OR REPLACE FUNCTION public.app_is_bootstrap()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $function$
  SELECT public.app_context_bootstrap()
$function$;

CREATE OR REPLACE FUNCTION public.app_can_manage_employees()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $function$
  SELECT app_private.tenant_context_is_valid()
    AND EXISTS (
      SELECT 1 FROM public.app_users actor
      WHERE actor.id = public.app_context_user_id()
        AND actor.active = true
        AND actor.role = 'supervisor'
        AND actor.business_id = public.app_current_business_id()
    )
$function$;

-- Las políticas que antes leían GUC directamente ahora usan funciones que
-- devuelven valores únicamente cuando el HMAC del contexto es válido.
DROP POLICY IF EXISTS mattsystem_password_resets_all ON public.admin_password_resets;
CREATE POLICY mattsystem_password_resets_all ON public.admin_password_resets
  FOR ALL TO PUBLIC
  USING (public.app_is_platform_admin() OR user_id = public.app_context_user_id())
  WITH CHECK (public.app_is_platform_admin() OR user_id = public.app_context_user_id());

DROP POLICY IF EXISTS mattsystem_tenant_select ON public.app_business_config;
CREATE POLICY mattsystem_tenant_select ON public.app_business_config
  FOR SELECT TO PUBLIC
  USING (public.app_is_platform_admin()
    OR business_id = public.app_current_business_id()
    OR business_id = public.app_context_public_catalog_business_id());

DROP POLICY IF EXISTS mattsystem_tenant_select ON public.app_licenses;
CREATE POLICY mattsystem_tenant_select ON public.app_licenses
  FOR SELECT TO PUBLIC
  USING (public.app_is_platform_admin()
    OR business_id = public.app_current_business_id()
    OR business_id = public.app_context_public_catalog_business_id());

DROP POLICY IF EXISTS mattsystem_login_attempts_scope ON public.app_login_attempts;
CREATE POLICY mattsystem_login_attempts_scope ON public.app_login_attempts
  FOR ALL TO PUBLIC
  USING (public.app_is_platform_admin()
    OR lower(email) = lower(public.app_context_login_email()))
  WITH CHECK (public.app_is_platform_admin()
    OR lower(email) = lower(public.app_context_login_email()));

DROP POLICY IF EXISTS app_login_ip_attempts_scope ON public.app_login_ip_attempts;
CREATE POLICY app_login_ip_attempts_scope ON public.app_login_ip_attempts
  FOR ALL TO PUBLIC
  USING (ip_hash = public.app_context_ip_hash())
  WITH CHECK (ip_hash = public.app_context_ip_hash());

DROP POLICY IF EXISTS mattsystem_notification_preferences_all ON public.app_notification_preferences;
CREATE POLICY mattsystem_notification_preferences_all ON public.app_notification_preferences
  FOR ALL TO PUBLIC
  USING (public.app_is_platform_admin() OR user_id = public.app_context_user_id())
  WITH CHECK (public.app_is_platform_admin() OR user_id = public.app_context_user_id());

DROP POLICY IF EXISTS mattsystem_tenant_select ON public.app_state;
CREATE POLICY mattsystem_tenant_select ON public.app_state
  FOR SELECT TO PUBLIC
  USING (public.app_is_platform_admin()
    OR business_id = public.app_current_business_id()
    OR business_id = public.app_context_public_catalog_business_id());

DROP POLICY IF EXISTS mattsystem_support_replies_insert ON public.app_support_replies;
CREATE POLICY mattsystem_support_replies_insert ON public.app_support_replies
  FOR INSERT TO PUBLIC
  WITH CHECK (
    public.app_is_platform_admin()
    OR (
      author_user_id = public.app_context_user_id()
      AND EXISTS (
        SELECT 1 FROM public.app_support_tickets t
        WHERE t.id = app_support_replies.ticket_id
          AND t.business_id = public.app_current_business_id()
      )
    )
  );

DROP POLICY IF EXISTS mattsystem_users_select ON public.app_users;
CREATE POLICY mattsystem_users_select ON public.app_users
  FOR SELECT TO PUBLIC
  USING (
    public.app_is_platform_admin()
    OR id = public.app_context_user_id()
    OR business_id = public.app_current_business_id()
    OR lower(email) = lower(public.app_context_login_email())
    OR (public.app_is_bootstrap() AND is_platform_admin = true)
  );

DROP POLICY IF EXISTS mattsystem_business_select ON public.businesses;
CREATE POLICY mattsystem_business_select ON public.businesses
  FOR SELECT TO PUBLIC
  USING (
    public.app_is_platform_admin()
    OR id = public.app_current_business_id()
    OR id = public.app_context_public_catalog_business_id()
  );

INSERT INTO public.schema_migrations(version)
VALUES ('034_signed_tenant_context')
ON CONFLICT (version) DO NOTHING;

COMMIT;
