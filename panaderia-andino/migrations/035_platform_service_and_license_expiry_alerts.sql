-- 035: costos con fechas de renovación y avisos de vencimiento de plataforma/licencias.
BEGIN;

ALTER TABLE public.app_platform_expenses
  ADD COLUMN IF NOT EXISTS renewal_date date;

CREATE TABLE IF NOT EXISTS public.app_platform_notification_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled boolean NOT NULL DEFAULT true,
  days_before integer NOT NULL DEFAULT 15 CHECK (days_before BETWEEN 1 AND 90),
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.app_platform_notification_settings(id,enabled,days_before)
VALUES (1,true,15)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.app_expiry_alert_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('service','license')),
  entity_id uuid NOT NULL,
  due_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_type,entity_id,due_date)
);

ALTER TABLE public.app_platform_notification_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_platform_notification_settings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_platform_notification_settings_admin ON public.app_platform_notification_settings;
CREATE POLICY app_platform_notification_settings_admin ON public.app_platform_notification_settings
  FOR ALL TO PUBLIC
  USING (public.app_is_platform_admin())
  WITH CHECK (public.app_is_platform_admin());

ALTER TABLE public.app_expiry_alert_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_expiry_alert_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_expiry_alert_events_admin ON public.app_expiry_alert_events;
CREATE POLICY app_expiry_alert_events_admin ON public.app_expiry_alert_events
  FOR ALL TO PUBLIC
  USING (public.app_is_platform_admin())
  WITH CHECK (public.app_is_platform_admin());

DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['mattsystem_runtime','mattsystem_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_platform_notification_settings TO %I', role_name);
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_expiry_alert_events TO %I', role_name);
    END IF;
  END LOOP;
END
$$;

INSERT INTO public.schema_migrations(version)
VALUES ('035_platform_service_and_license_expiry_alerts')
ON CONFLICT (version) DO NOTHING;

COMMIT;
