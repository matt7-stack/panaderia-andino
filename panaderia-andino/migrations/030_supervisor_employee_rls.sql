-- 030: preserve the business supervisor's employee-management workflow under RLS.
BEGIN;
CREATE OR REPLACE FUNCTION public.app_can_manage_employees()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users actor
    WHERE actor.id = NULLIF(current_setting('app.user_id', true), '')::uuid
      AND actor.active = TRUE
      AND actor.role = 'supervisor'
      AND actor.business_id = public.app_current_business_id()
  )
$$;
GRANT EXECUTE ON FUNCTION public.app_can_manage_employees() TO mattsystem_runtime;

DROP POLICY IF EXISTS mattsystem_users_insert ON public.app_users;
DROP POLICY IF EXISTS mattsystem_users_update ON public.app_users;

CREATE POLICY mattsystem_users_insert ON public.app_users FOR INSERT WITH CHECK (
  public.app_is_platform_admin()
  OR (
    public.app_can_manage_employees()
    AND business_id = public.app_current_business_id()
    AND role = 'employee'
    AND is_platform_admin = FALSE
  )
);

CREATE POLICY mattsystem_users_update ON public.app_users FOR UPDATE
USING (
  public.app_is_platform_admin()
  OR (
    public.app_can_manage_employees()
    AND business_id = public.app_current_business_id()
    AND role = 'employee'
    AND is_platform_admin = FALSE
  )
)
WITH CHECK (
  public.app_is_platform_admin()
  OR (
    public.app_can_manage_employees()
    AND business_id = public.app_current_business_id()
    AND role = 'employee'
    AND is_platform_admin = FALSE
  )
);

-- Published release notes remain readable to signed-out users; editing stays platform-admin-only.
ALTER TABLE public.app_release_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_release_notes FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mattsystem_release_notes_public_read ON public.app_release_notes;
DROP POLICY IF EXISTS mattsystem_release_notes_admin_write ON public.app_release_notes;
CREATE POLICY mattsystem_release_notes_public_read ON public.app_release_notes FOR SELECT
USING (published = TRUE OR public.app_is_platform_admin());
CREATE POLICY mattsystem_release_notes_admin_write ON public.app_release_notes FOR ALL
USING (public.app_is_platform_admin()) WITH CHECK (public.app_is_platform_admin());

INSERT INTO schema_migrations(version)
VALUES ('030_supervisor_employee_rls')
ON CONFLICT(version) DO NOTHING;
COMMIT;
