-- 036: baja formal de empleados, historial permanente y auditoría por negocio.
BEGIN;

CREATE TABLE IF NOT EXISTS public.app_employee_offboarding_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  employee_name text NOT NULL,
  employee_email text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('termination_requested','terminated','reactivated')),
  reason text,
  notes text,
  actor_user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_employee_offboarding_events_business_created_idx
  ON public.app_employee_offboarding_events(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS app_employee_offboarding_events_employee_idx
  ON public.app_employee_offboarding_events(employee_user_id, created_at DESC);

ALTER TABLE public.app_employee_offboarding_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_employee_offboarding_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_employee_offboarding_events_tenant ON public.app_employee_offboarding_events;
CREATE POLICY app_employee_offboarding_events_tenant
  ON public.app_employee_offboarding_events
  FOR SELECT TO PUBLIC
  USING (public.app_is_platform_admin() OR business_id = public.app_current_business_id());
DROP POLICY IF EXISTS app_employee_offboarding_events_insert ON public.app_employee_offboarding_events;
CREATE POLICY app_employee_offboarding_events_insert
  ON public.app_employee_offboarding_events
  FOR INSERT TO PUBLIC
  WITH CHECK (
    public.app_is_platform_admin()
    OR (business_id = public.app_current_business_id()
        AND actor_user_id = public.app_context_user_id())
  );

DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['mattsystem_runtime','mattsystem_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('GRANT SELECT, INSERT ON public.app_employee_offboarding_events TO %I', role_name);
    END IF;
  END LOOP;
END
$$;

INSERT INTO public.schema_migrations(version)
VALUES ('036_employee_offboarding')
ON CONFLICT (version) DO NOTHING;

COMMIT;
