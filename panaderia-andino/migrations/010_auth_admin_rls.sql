BEGIN;

-- Funciones de autenticación: las consultas previas al login no deben abrir las tablas
-- de usuarios/negocios/licencias al rol de aplicación.
CREATE OR REPLACE FUNCTION public.app_auth_user_by_id(p_user_id uuid, p_system text)
RETURNS TABLE (
 id uuid,name text,email text,role text,active boolean,business_id uuid,is_platform_admin boolean,
 session_version integer,permissions jsonb,business_name text,license_code text,license_system_name text,
 license_status text,license_expires_at date,license_is_valid boolean,license_plan text,
 license_is_trial boolean,license_trial_started_at timestamptz,license_trial_days integer,
 license_user_limit integer,license_device_limit integer,created_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT u.id,u.name,u.email,u.role,u.active,u.business_id,u.is_platform_admin,u.session_version,u.permissions,
        b.name,lic.license_code,lic.system_name,lic.status,lic.expires_at,
        (lic.status='active' AND (lic.expires_at IS NULL OR lic.expires_at>=CURRENT_DATE)),
        lic.plan,lic.is_trial,lic.trial_started_at,lic.trial_days,lic.user_limit,lic.device_limit,u.created_at
 FROM public.app_users u
 LEFT JOIN public.businesses b ON b.id=u.business_id
 LEFT JOIN LATERAL (
   SELECT l.license_code,l.system_name,l.status,l.expires_at,l.plan,l.is_trial,l.trial_started_at,l.trial_days,l.user_limit,l.device_limit
   FROM public.app_licenses l WHERE l.business_id=u.business_id AND lower(btrim(l.system_name))=lower(btrim(p_system))
   ORDER BY l.created_at DESC,l.id DESC LIMIT 1
 ) lic ON true
 WHERE u.id=p_user_id AND (u.is_platform_admin OR b.active=true)
 LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.app_auth_user_by_email(p_email text,p_system text)
RETURNS TABLE (
 id uuid,name text,email text,password_hash text,role text,active boolean,business_id uuid,is_platform_admin boolean,
 session_version integer,permissions jsonb,license_code text,license_system_name text,license_status text,
 license_expires_at date,license_is_valid boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT u.id,u.name,u.email,u.password_hash,u.role,u.active,u.business_id,u.is_platform_admin,u.session_version,u.permissions,
        lic.license_code,lic.system_name,lic.status,lic.expires_at,
        (lic.status='active' AND (lic.expires_at IS NULL OR lic.expires_at>=CURRENT_DATE))
 FROM public.app_users u
 LEFT JOIN public.businesses b ON b.id=u.business_id
 LEFT JOIN LATERAL (
   SELECT l.license_code,l.system_name,l.status,l.expires_at
   FROM public.app_licenses l WHERE l.business_id=u.business_id AND lower(btrim(l.system_name))=lower(btrim(p_system))
   ORDER BY l.created_at DESC,l.id DESC LIMIT 1
 ) lic ON true
 WHERE lower(u.email)=lower(p_email) AND (u.is_platform_admin=true OR b.active=true) LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.app_auth_admin_exists()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ SELECT EXISTS(SELECT 1 FROM public.app_users WHERE is_platform_admin=true) $$;

CREATE OR REPLACE FUNCTION public.app_auth_claim_setup_token(p_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE claimed text;
BEGIN
 UPDATE public.app_admin_setup_tokens SET used_at=now()
 WHERE token_hash=p_hash AND used_at IS NULL AND expires_at>now()
 RETURNING token_hash INTO claimed;
 RETURN claimed IS NOT NULL;
END $$;

CREATE OR REPLACE FUNCTION public.app_auth_attempt_state(p_email text)
RETURNS TABLE(failures integer,locked_until timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT a.failures,a.locked_until FROM public.app_login_attempts a WHERE a.email=p_email LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.app_auth_attempt_record(p_email text)
RETURNS TABLE(failures integer,locked_until timestamptz)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 INSERT INTO public.app_login_attempts(email,failures,locked_until,updated_at)
 VALUES(p_email,1,NULL,now())
 ON CONFLICT(email) DO UPDATE SET
 failures=CASE WHEN app_login_attempts.updated_at<now()-interval '15 minutes' THEN 1 ELSE app_login_attempts.failures+1 END,
 locked_until=CASE WHEN (CASE WHEN app_login_attempts.updated_at<now()-interval '15 minutes' THEN 1 ELSE app_login_attempts.failures+1 END)>=6 THEN now()+interval '15 minutes' ELSE NULL END,
 updated_at=now()
 RETURNING app_login_attempts.failures,app_login_attempts.locked_until
$$;

CREATE OR REPLACE FUNCTION public.app_auth_attempt_clear(p_email text)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ DELETE FROM public.app_login_attempts WHERE email=p_email $$;

REVOKE ALL ON FUNCTION public.app_auth_user_by_id(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_auth_user_by_email(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_auth_admin_exists() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_auth_claim_setup_token(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_auth_attempt_state(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_auth_attempt_record(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.app_auth_attempt_clear(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_auth_user_by_id(uuid,text) TO mattsystem_app;
GRANT EXECUTE ON FUNCTION public.app_auth_user_by_email(text,text) TO mattsystem_app;
GRANT EXECUTE ON FUNCTION public.app_auth_admin_exists() TO mattsystem_app;
GRANT EXECUTE ON FUNCTION public.app_auth_claim_setup_token(text) TO mattsystem_app;
GRANT EXECUTE ON FUNCTION public.app_auth_attempt_state(text) TO mattsystem_app;
GRANT EXECUTE ON FUNCTION public.app_auth_attempt_record(text) TO mattsystem_app;
GRANT EXECUTE ON FUNCTION public.app_auth_attempt_clear(text) TO mattsystem_app;

-- RLS para tablas de identidad, administración y licencias. Se habilita sin FORCE
-- para que las funciones SECURITY DEFINER propiedad del migrador puedan resolver login.
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_users_tenant_or_platform ON public.app_users;
CREATE POLICY app_users_tenant_or_platform ON public.app_users FOR ALL TO mattsystem_app
 USING (public.app_ctx_is_platform_admin() OR (business_id IS NOT NULL AND business_id=public.app_ctx_business_id()))
 WITH CHECK (public.app_ctx_is_platform_admin() OR (business_id IS NOT NULL AND business_id=public.app_ctx_business_id()));

ALTER TABLE public.businesses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS businesses_tenant_read ON public.businesses;
DROP POLICY IF EXISTS businesses_platform_write ON public.businesses;
CREATE POLICY businesses_tenant_read ON public.businesses FOR SELECT TO mattsystem_app
 USING (public.app_ctx_is_platform_admin() OR id=public.app_ctx_business_id());
CREATE POLICY businesses_platform_write ON public.businesses FOR ALL TO mattsystem_app
 USING (public.app_ctx_is_platform_admin()) WITH CHECK (public.app_ctx_is_platform_admin());

ALTER TABLE public.app_licenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mattsystem_tenant_isolation ON public.app_licenses;
CREATE POLICY mattsystem_license_read ON public.app_licenses FOR SELECT TO mattsystem_app
 USING (public.app_ctx_is_platform_admin() OR business_id=public.app_ctx_business_id());
CREATE POLICY mattsystem_license_update ON public.app_licenses FOR UPDATE TO mattsystem_app
 USING (public.app_ctx_is_platform_admin() OR business_id=public.app_ctx_business_id())
 WITH CHECK (public.app_ctx_is_platform_admin() OR business_id=public.app_ctx_business_id());
CREATE POLICY mattsystem_license_admin_insert ON public.app_licenses FOR INSERT TO mattsystem_app
 WITH CHECK (public.app_ctx_is_platform_admin());
CREATE POLICY mattsystem_license_admin_delete ON public.app_licenses FOR DELETE TO mattsystem_app
 USING (public.app_ctx_is_platform_admin());

ALTER TABLE public.app_login_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_login_attempts_scoped ON public.app_login_attempts;
CREATE POLICY app_login_attempts_scoped ON public.app_login_attempts FOR ALL TO mattsystem_app
 USING (public.app_ctx_is_platform_admin() OR email=('license:'||public.app_ctx_user_id()::text))
 WITH CHECK (public.app_ctx_is_platform_admin() OR email=('license:'||public.app_ctx_user_id()::text));

ALTER TABLE public.app_admin_setup_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_password_resets ENABLE ROW LEVEL SECURITY;
-- No direct policy: only SECURITY DEFINER bootstrap/recovery functions may access tokens.

ALTER TABLE public.app_license_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_license_settings_platform_only ON public.app_license_settings;
CREATE POLICY app_license_settings_platform_only ON public.app_license_settings FOR ALL TO mattsystem_app
 USING (public.app_ctx_is_platform_admin()) WITH CHECK (public.app_ctx_is_platform_admin());

ALTER TABLE public.app_platform_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_platform_settings_public_support ON public.app_platform_settings;
DROP POLICY IF EXISTS app_platform_settings_platform_write ON public.app_platform_settings;
CREATE POLICY app_platform_settings_public_support ON public.app_platform_settings FOR SELECT TO mattsystem_app
 USING (setting_key='support' OR public.app_ctx_is_platform_admin());
CREATE POLICY app_platform_settings_platform_write ON public.app_platform_settings FOR ALL TO mattsystem_app
 USING (public.app_ctx_is_platform_admin()) WITH CHECK (public.app_ctx_is_platform_admin());

ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.schema_migrations FROM PUBLIC,mattsystem_app;
REVOKE ALL ON public.app_admin_setup_tokens FROM PUBLIC;
REVOKE ALL ON public.admin_password_resets FROM PUBLIC;

INSERT INTO public.schema_migrations(version)
VALUES ('010_auth_admin_rls')
ON CONFLICT(version) DO NOTHING;

COMMIT;
