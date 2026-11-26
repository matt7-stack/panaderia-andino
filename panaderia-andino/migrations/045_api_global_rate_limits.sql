-- 045: global API request throttling by hashed client IP.
BEGIN;

CREATE TABLE IF NOT EXISTS public.app_api_rate_limits (
  ip_hash text PRIMARY KEY,
  window_started timestamptz NOT NULL DEFAULT NOW(),
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS app_api_rate_limits_updated_idx
  ON public.app_api_rate_limits(updated_at);

ALTER TABLE public.app_api_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_api_rate_limits FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_api_rate_limits_ip_scope ON public.app_api_rate_limits;
CREATE POLICY app_api_rate_limits_ip_scope ON public.app_api_rate_limits
  FOR ALL TO PUBLIC
  USING (ip_hash = public.app_context_ip_hash())
  WITH CHECK (ip_hash = public.app_context_ip_hash());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mattsystem_runtime') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_api_rate_limits TO mattsystem_runtime;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mattsystem_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_api_rate_limits TO mattsystem_app;
  END IF;
END $$;

INSERT INTO public.schema_migrations(version)
VALUES ('045_api_global_rate_limits')
ON CONFLICT (version) DO NOTHING;

COMMIT;
