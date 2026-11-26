-- 037: las licencias solo pueden ser modificadas por el administrador de plataforma.
-- Los negocios mantienen lectura de su propia licencia, pero nunca escritura directa.
BEGIN;

DROP POLICY IF EXISTS mattsystem_tenant_insert ON public.app_licenses;
DROP POLICY IF EXISTS mattsystem_tenant_update ON public.app_licenses;
DROP POLICY IF EXISTS mattsystem_tenant_delete ON public.app_licenses;
DROP POLICY IF EXISTS mattsystem_license_insert_admin ON public.app_licenses;
DROP POLICY IF EXISTS mattsystem_license_update_admin ON public.app_licenses;
DROP POLICY IF EXISTS mattsystem_license_delete_admin ON public.app_licenses;

CREATE POLICY mattsystem_license_insert_admin
  ON public.app_licenses
  FOR INSERT TO PUBLIC
  WITH CHECK (public.app_is_platform_admin());

CREATE POLICY mattsystem_license_update_admin
  ON public.app_licenses
  FOR UPDATE TO PUBLIC
  USING (public.app_is_platform_admin())
  WITH CHECK (public.app_is_platform_admin());

CREATE POLICY mattsystem_license_delete_admin
  ON public.app_licenses
  FOR DELETE TO PUBLIC
  USING (public.app_is_platform_admin());

INSERT INTO public.schema_migrations(version)
VALUES ('037_license_write_restrictions')
ON CONFLICT (version) DO NOTHING;

COMMIT;
