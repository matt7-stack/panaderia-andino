-- 043: múltiples alertas configurables por vencimiento.
BEGIN;
ALTER TABLE public.app_platform_notification_settings
  ADD COLUMN IF NOT EXISTS alert_days integer[] NOT NULL DEFAULT ARRAY[7,3,0]::integer[];
ALTER TABLE public.app_platform_notification_settings
  ALTER COLUMN alert_days SET DEFAULT ARRAY[7,3,0]::integer[];
UPDATE public.app_platform_notification_settings
SET alert_days=ARRAY[7,3,0]::integer[],days_before=7
WHERE id=1 AND alert_days=ARRAY[15]::integer[];
ALTER TABLE public.app_expiry_alert_events
  ADD COLUMN IF NOT EXISTS alert_days_before integer NOT NULL DEFAULT 0;
ALTER TABLE public.app_expiry_alert_events
  DROP CONSTRAINT IF EXISTS app_expiry_alert_events_entity_type_entity_id_due_date_key;
CREATE UNIQUE INDEX IF NOT EXISTS app_expiry_alert_events_unique_alert
  ON public.app_expiry_alert_events(entity_type,entity_id,due_date,alert_days_before);
INSERT INTO public.schema_migrations(version)
VALUES ('043_multiple_expiry_alert_days')
ON CONFLICT (version) DO NOTHING;
COMMIT;
