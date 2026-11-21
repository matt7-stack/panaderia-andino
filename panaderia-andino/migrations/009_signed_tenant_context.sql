BEGIN;

-- Contexto de tenant firmado: los GUC personalizados pueden ser escritos por cualquier
-- sesión PostgreSQL. Por eso nunca se confía en ellos sin validar una firma HMAC.
CREATE SCHEMA IF NOT EXISTS app_private;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
REVOKE ALL ON SCHEMA app_private FROM mattsystem_app;

CREATE TABLE IF NOT EXISTS app_private.tenant_context_secret (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton = true),
  secret_hex text NOT NULL CHECK (secret_hex ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON app_private.tenant_context_secret FROM PUBLIC, mattsystem_app;

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
            COALESCE(current_setting('app.is_platform_admin', true), 'false'),
            'UTF8'
          ),
          decode(s.secret_hex, 'hex'),
          'sha256'
        ),
        'hex'
      ) = COALESCE(current_setting('app.context_signature', true), '')
  )
$function$;
REVOKE ALL ON FUNCTION app_private.tenant_context_is_valid() FROM PUBLIC, mattsystem_app;

CREATE OR REPLACE FUNCTION public.app_ctx_business_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $function$
  SELECT CASE WHEN app_private.tenant_context_is_valid()
    THEN NULLIF(current_setting('app.business_id', true), '')::uuid
    ELSE NULL::uuid END
$function$;

CREATE OR REPLACE FUNCTION public.app_ctx_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $function$
  SELECT CASE WHEN app_private.tenant_context_is_valid()
    THEN NULLIF(current_setting('app.user_id', true), '')::uuid
    ELSE NULL::uuid END
$function$;

CREATE OR REPLACE FUNCTION public.app_ctx_is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $function$
  SELECT app_private.tenant_context_is_valid()
    AND COALESCE(NULLIF(current_setting('app.is_platform_admin', true), '')::boolean, false)
$function$;

REVOKE ALL ON FUNCTION public.app_ctx_business_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_ctx_user_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_ctx_is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_ctx_business_id() TO mattsystem_app;
GRANT EXECUTE ON FUNCTION public.app_ctx_user_id() TO mattsystem_app;
GRANT EXECUTE ON FUNCTION public.app_ctx_is_platform_admin() TO mattsystem_app;

INSERT INTO public.schema_migrations(version)
VALUES ('009_signed_tenant_context')
ON CONFLICT (version) DO NOTHING;

COMMIT;
