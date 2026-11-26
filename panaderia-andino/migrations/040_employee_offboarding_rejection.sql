-- 040: permitir registrar el rechazo formal de una solicitud de baja.
BEGIN;

ALTER TABLE public.app_employee_offboarding_events
  DROP CONSTRAINT IF EXISTS app_employee_offboarding_events_event_type_check;

ALTER TABLE public.app_employee_offboarding_events
  ADD CONSTRAINT app_employee_offboarding_events_event_type_check
  CHECK (event_type IN ('termination_requested','termination_rejected','terminated','reactivated'));

INSERT INTO public.schema_migrations(version)
VALUES ('040_employee_offboarding_rejection')
ON CONFLICT (version) DO NOTHING;

COMMIT;
