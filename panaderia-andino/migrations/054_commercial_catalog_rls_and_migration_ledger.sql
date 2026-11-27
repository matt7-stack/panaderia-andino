-- 054: close remaining platform catalog RLS gap and repair migration ledger.
-- Safe to re-run. This migration does not modify customer or business data.
BEGIN;

-- Migration 052 created the release tables but omitted its ledger entry.
-- The schema is present in QA; register it so health checks and future deploys
-- do not report an incomplete migration history.
INSERT INTO public.schema_migrations(version)
VALUES ('052_versioned_releases')
ON CONFLICT (version) DO NOTHING;

-- This is a platform-wide commercial catalog (not tenant data). It must only
-- be visible and writable by the MATTSYSTEM platform administrator.
ALTER TABLE public.app_commercial_other_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_commercial_other_prices FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mattsystem_commercial_other_prices_admin_all
  ON public.app_commercial_other_prices;
CREATE POLICY mattsystem_commercial_other_prices_admin_all
  ON public.app_commercial_other_prices
  FOR ALL TO PUBLIC
  USING (public.app_is_platform_admin())
  WITH CHECK (public.app_is_platform_admin());

-- Use the HMAC-validated identity helper for telemetry inserts too.
-- The previous policy compared actor_user_id with a raw custom GUC.
DROP POLICY IF EXISTS mattsystem_health_events_tenant_insert
  ON public.app_health_events;
CREATE POLICY mattsystem_health_events_tenant_insert
  ON public.app_health_events
  FOR INSERT TO PUBLIC
  WITH CHECK (
    actor_user_id = public.app_context_user_id()
    AND (business_id IS NULL OR business_id = public.app_current_business_id())
  );

INSERT INTO public.schema_migrations(version)
VALUES ('054_commercial_catalog_rls_and_migration_ledger')
ON CONFLICT (version) DO NOTHING;

COMMIT;
