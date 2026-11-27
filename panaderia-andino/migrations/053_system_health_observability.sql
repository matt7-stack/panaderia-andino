-- 053: observabilidad del sistema y trazabilidad de salud.
BEGIN;
CREATE TABLE IF NOT EXISTS app_health_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id) ON DELETE SET NULL,
  actor_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  category varchar(32) NOT NULL CHECK (category IN ('js_error','promise_rejection','api_error','api_slow')),
  message varchar(500) NOT NULL DEFAULT '',
  route varchar(240) NOT NULL DEFAULT '',
  duration_ms integer CHECK (duration_ms IS NULL OR duration_ms BETWEEN 0 AND 120000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_health_events_created_idx ON app_health_events(created_at DESC);
CREATE INDEX IF NOT EXISTS app_health_events_category_created_idx ON app_health_events(category,created_at DESC);
ALTER TABLE app_health_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_health_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mattsystem_health_events_admin ON app_health_events;
CREATE POLICY mattsystem_health_events_admin ON app_health_events FOR ALL
  USING (public.app_is_platform_admin()) WITH CHECK (public.app_is_platform_admin());
DROP POLICY IF EXISTS mattsystem_health_events_tenant_insert ON app_health_events;
CREATE POLICY mattsystem_health_events_tenant_insert ON app_health_events FOR INSERT
  WITH CHECK (actor_user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
    AND (business_id IS NULL OR business_id = public.app_current_business_id()));
CREATE TABLE IF NOT EXISTS app_health_snapshots (
  id bigserial PRIMARY KEY,
  captured_at timestamptz NOT NULL DEFAULT now(),
  overall_status varchar(20) NOT NULL CHECK (overall_status IN ('healthy','warning','critical','unknown')),
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS app_health_snapshots_captured_idx ON app_health_snapshots(captured_at DESC);
ALTER TABLE app_health_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_health_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mattsystem_health_snapshots_admin ON app_health_snapshots;
CREATE POLICY mattsystem_health_snapshots_admin ON app_health_snapshots FOR ALL
  USING (public.app_is_platform_admin()) WITH CHECK (public.app_is_platform_admin());
GRANT SELECT, INSERT ON app_health_events, app_health_snapshots TO mattsystem_runtime;
GRANT USAGE, SELECT ON SEQUENCE app_health_snapshots_id_seq TO mattsystem_runtime;
INSERT INTO schema_migrations(version) VALUES ('053_system_health_observability') ON CONFLICT(version) DO NOTHING;
COMMIT;
