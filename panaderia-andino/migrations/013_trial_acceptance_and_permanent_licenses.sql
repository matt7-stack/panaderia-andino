BEGIN;

-- Distingue explícitamente suscripción con vencimiento de licencia permanente.
ALTER TABLE public.app_licenses
  ADD COLUMN IF NOT EXISTS license_type text NOT NULL DEFAULT 'subscription';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid='public.app_licenses'::regclass
      AND conname='app_licenses_license_type_check'
  ) THEN
    ALTER TABLE public.app_licenses
      ADD CONSTRAINT app_licenses_license_type_check
      CHECK (license_type IN ('subscription','permanent'));
  END IF;
END $$;

-- Registro único e inmutable de aceptación de prueba por negocio.
CREATE TABLE IF NOT EXISTS public.app_trial_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE RESTRICT,
  license_id uuid NOT NULL REFERENCES public.app_licenses(id) ON DELETE RESTRICT,
  accepted_by uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  terms_version text NOT NULL CHECK (length(terms_version) BETWEEN 1 AND 80),
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_trial_claims_business_unique UNIQUE (business_id),
  CONSTRAINT app_trial_claims_license_unique UNIQUE (license_id)
);

ALTER TABLE public.app_trial_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_trial_claims FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_trial_claims_tenant_select ON public.app_trial_claims;
DROP POLICY IF EXISTS app_trial_claims_tenant_insert ON public.app_trial_claims;
CREATE POLICY app_trial_claims_tenant_select
  ON public.app_trial_claims FOR SELECT TO mattsystem_app
  USING (public.app_ctx_is_platform_admin() OR business_id=public.app_ctx_business_id());
CREATE POLICY app_trial_claims_tenant_insert
  ON public.app_trial_claims FOR INSERT TO mattsystem_app
  WITH CHECK (
    business_id=public.app_ctx_business_id()
    AND accepted_by=public.app_ctx_user_id()
    AND public.app_ctx_is_platform_admin()=false
  );
GRANT SELECT, INSERT ON public.app_trial_claims TO mattsystem_app;

-- Expone únicamente los parámetros de prueba necesarios para que un negocio
-- pueda solicitarla sin leer la tabla de configuración reservada a plataforma.
CREATE OR REPLACE FUNCTION public.app_trial_settings()
RETURNS TABLE(trial_enabled boolean, trial_days integer, device_limit integer)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public
AS $function$
  SELECT
    COALESCE((SELECT s.trial_enabled FROM public.app_license_settings s WHERE s.setting_key='default' LIMIT 1),false),
    GREATEST(1,LEAST(30,COALESCE((SELECT s.trial_days FROM public.app_license_settings s WHERE s.setting_key='default' LIMIT 1),7))),
    GREATEST(1,COALESCE((SELECT s.device_limit FROM public.app_license_settings s WHERE s.setting_key='default' LIMIT 1),3))
$function$;
REVOKE ALL ON FUNCTION public.app_trial_settings() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_trial_settings() TO mattsystem_app;

-- Una suscripción requiere vencimiento y una licencia permanente no vence.
CREATE OR REPLACE FUNCTION public.app_auth_user_by_id(p_user_id uuid, p_system text)
RETURNS TABLE (
 id uuid,name text,email text,role text,active boolean,business_id uuid,is_platform_admin boolean,
 session_version integer,permissions jsonb,business_name text,license_code text,license_system_name text,
 license_status text,license_expires_at date,license_is_valid boolean,license_plan text,
 license_is_trial boolean,license_trial_started_at timestamptz,license_trial_days integer,
 license_user_limit integer,license_device_limit integer,created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
 SELECT u.id,u.name,u.email,u.role,u.active,u.business_id,u.is_platform_admin,u.session_version,u.permissions,
        b.name,lic.license_code,lic.system_name,lic.status,lic.expires_at,
        (lic.status='active' AND (lic.license_type='permanent' OR (lic.expires_at IS NOT NULL AND lic.expires_at>=CURRENT_DATE))),
        lic.plan,lic.is_trial,lic.trial_started_at,lic.trial_days,lic.user_limit,lic.device_limit,u.created_at
 FROM public.app_users u
 LEFT JOIN public.businesses b ON b.id=u.business_id
 LEFT JOIN LATERAL (
   SELECT l.license_code,l.system_name,l.status,l.expires_at,l.plan,l.license_type,l.is_trial,l.trial_started_at,l.trial_days,l.user_limit,l.device_limit
   FROM public.app_licenses l WHERE l.business_id=u.business_id AND lower(btrim(l.system_name))=lower(btrim(p_system))
   ORDER BY l.created_at DESC,l.id DESC LIMIT 1
 ) lic ON true
 WHERE u.id=p_user_id AND (u.is_platform_admin OR b.active=true)
 LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.app_auth_user_by_email(p_email text,p_system text)
RETURNS TABLE (
 id uuid,name text,email text,password_hash text,role text,active boolean,business_id uuid,is_platform_admin boolean,
 session_version integer,permissions jsonb,license_code text,license_system_name text,license_status text,
 license_expires_at date,license_is_valid boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
 SELECT u.id,u.name,u.email,u.password_hash,u.role,u.active,u.business_id,u.is_platform_admin,u.session_version,u.permissions,
        lic.license_code,lic.system_name,lic.status,lic.expires_at,
        (lic.status='active' AND (lic.license_type='permanent' OR (lic.expires_at IS NOT NULL AND lic.expires_at>=CURRENT_DATE)))
 FROM public.app_users u
 LEFT JOIN public.businesses b ON b.id=u.business_id
 LEFT JOIN LATERAL (
   SELECT l.license_code,l.system_name,l.status,l.expires_at,l.license_type
   FROM public.app_licenses l WHERE l.business_id=u.business_id AND lower(btrim(l.system_name))=lower(btrim(p_system))
   ORDER BY l.created_at DESC,l.id DESC LIMIT 1
 ) lic ON true
 WHERE lower(u.email)=lower(p_email) AND (u.is_platform_admin=true OR b.active=true)
 LIMIT 1
$function$;

REVOKE ALL ON FUNCTION public.app_auth_user_by_id(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_auth_user_by_email(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_auth_user_by_id(uuid,text) TO mattsystem_app;
GRANT EXECUTE ON FUNCTION public.app_auth_user_by_email(text,text) TO mattsystem_app;

INSERT INTO public.schema_migrations(version)
VALUES ('013_trial_acceptance_and_permanent_licenses')
ON CONFLICT (version) DO NOTHING;

COMMIT;
