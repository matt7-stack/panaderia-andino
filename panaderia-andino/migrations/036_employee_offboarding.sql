-- 036: baja formal, solicitudes y reactivación controlada de empleados.
BEGIN;

CREATE TABLE IF NOT EXISTS public.app_employee_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  employee_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('termination_requested','terminated','reactivated','termination_request_rejected')),
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('pending','completed','rejected')),
  reason text NOT NULL DEFAULT '',
  private_notes text NOT NULL DEFAULT '',
  resolved_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_employee_lifecycle_business_created_idx
  ON public.app_employee_lifecycle_events(business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS app_employee_lifecycle_pending_idx
  ON public.app_employee_lifecycle_events(business_id, status, created_at DESC)
  WHERE event_type='termination_requested' AND status='pending';

ALTER TABLE public.app_employee_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_employee_lifecycle_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_employee_lifecycle_business_scope ON public.app_employee_lifecycle_events;
CREATE POLICY app_employee_lifecycle_business_scope
  ON public.app_employee_lifecycle_events
  FOR ALL TO PUBLIC
  USING (public.app_is_platform_admin() OR business_id=public.app_current_business_id())
  WITH CHECK (public.app_is_platform_admin() OR business_id=public.app_current_business_id());

DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['mattsystem_runtime','mattsystem_app'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE ON public.app_employee_lifecycle_events TO %I', role_name);
    END IF;
  END LOOP;
END
$$;

INSERT INTO public.schema_migrations(version)
VALUES ('036_employee_offboarding')
ON CONFLICT (version) DO NOTHING;

COMMIT;
