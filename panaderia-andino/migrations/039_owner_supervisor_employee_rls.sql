-- 039: permitir al Dueño y al Supervisor administrar cuentas de empleados.
-- Se mantiene el aislamiento por negocio y se excluyen las cuentas del administrador de plataforma.
BEGIN;

CREATE OR REPLACE FUNCTION public.app_can_manage_employees()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, app_private
AS $$
  SELECT app_private.tenant_context_is_valid()
    AND EXISTS (
      SELECT 1
      FROM public.app_users actor
      WHERE actor.id = public.app_context_user_id()
        AND actor.active = TRUE
        AND actor.role IN ('admin', 'supervisor')
        AND actor.is_platform_admin = FALSE
        AND actor.business_id = public.app_current_business_id()
    )
$$;

GRANT EXECUTE ON FUNCTION public.app_can_manage_employees() TO mattsystem_runtime;

INSERT INTO public.schema_migrations(version)
VALUES ('039_owner_supervisor_employee_rls')
ON CONFLICT (version) DO NOTHING;

COMMIT;
