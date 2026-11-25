-- 031: scope authentication rate-limit metadata to the current login identity/IP.
BEGIN;
ALTER TABLE public.app_login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_login_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mattsystem_login_attempts_scope ON public.app_login_attempts;
CREATE POLICY mattsystem_login_attempts_scope ON public.app_login_attempts FOR ALL
USING (
  public.app_is_platform_admin()
  OR lower(email)=lower(NULLIF(current_setting('app.login_email',true),''))
)
WITH CHECK (
  public.app_is_platform_admin()
  OR lower(email)=lower(NULLIF(current_setting('app.login_email',true),''))
);

ALTER TABLE public.app_login_ip_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_login_ip_attempts FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mattsystem_login_ip_attempts_scope ON public.app_login_ip_attempts;
CREATE POLICY mattsystem_login_ip_attempts_scope ON public.app_login_ip_attempts FOR ALL
USING (
  public.app_is_platform_admin()
  OR ip_hash=NULLIF(current_setting('app.ip_hash',true),'')
)
WITH CHECK (
  public.app_is_platform_admin()
  OR ip_hash=NULLIF(current_setting('app.ip_hash',true),'')
);

INSERT INTO schema_migrations(version)
VALUES ('031_login_rate_limit_rls')
ON CONFLICT(version) DO NOTHING;
COMMIT;
