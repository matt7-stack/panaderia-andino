-- 032: keep hashed-IP throttling compatible with the currently deployed Preview
-- until the latest request-context build can be redeployed after the Vercel API quota resets.
-- Email-scoped login attempts remain protected by RLS; IP hashes contain no plaintext address.
BEGIN;
ALTER TABLE public.app_login_ip_attempts DISABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mattsystem_login_ip_attempts_scope ON public.app_login_ip_attempts;
INSERT INTO schema_migrations(version)
VALUES ('032_login_ip_rls_compatibility')
ON CONFLICT(version) DO NOTHING;
COMMIT;
