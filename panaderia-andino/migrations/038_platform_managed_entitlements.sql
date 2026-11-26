-- 038: la configuración comercial, los módulos contratados y complementos son gestionados por plataforma.
-- Los negocios conservan lectura de su propia configuración, pero no pueden alterarla directamente.
BEGIN;

DROP POLICY IF EXISTS mattsystem_tenant_insert ON public.app_business_config;
DROP POLICY IF EXISTS mattsystem_tenant_update ON public.app_business_config;
DROP POLICY IF EXISTS mattsystem_tenant_delete ON public.app_business_config;
DROP POLICY IF EXISTS mattsystem_tenant_insert ON public.app_business_addons;
DROP POLICY IF EXISTS mattsystem_tenant_update ON public.app_business_addons;
DROP POLICY IF EXISTS mattsystem_tenant_delete ON public.app_business_addons;

DROP POLICY IF EXISTS mattsystem_business_config_insert_admin ON public.app_business_config;
DROP POLICY IF EXISTS mattsystem_business_config_update_admin ON public.app_business_config;
DROP POLICY IF EXISTS mattsystem_business_config_delete_admin ON public.app_business_config;
DROP POLICY IF EXISTS mattsystem_business_addons_insert_admin ON public.app_business_addons;
DROP POLICY IF EXISTS mattsystem_business_addons_update_admin ON public.app_business_addons;
DROP POLICY IF EXISTS mattsystem_business_addons_delete_admin ON public.app_business_addons;

CREATE POLICY mattsystem_business_config_insert_admin
  ON public.app_business_config FOR INSERT TO PUBLIC
  WITH CHECK (public.app_is_platform_admin());
CREATE POLICY mattsystem_business_config_update_admin
  ON public.app_business_config FOR UPDATE TO PUBLIC
  USING (public.app_is_platform_admin())
  WITH CHECK (public.app_is_platform_admin());
CREATE POLICY mattsystem_business_config_delete_admin
  ON public.app_business_config FOR DELETE TO PUBLIC
  USING (public.app_is_platform_admin());

CREATE POLICY mattsystem_business_addons_insert_admin
  ON public.app_business_addons FOR INSERT TO PUBLIC
  WITH CHECK (public.app_is_platform_admin());
CREATE POLICY mattsystem_business_addons_update_admin
  ON public.app_business_addons FOR UPDATE TO PUBLIC
  USING (public.app_is_platform_admin())
  WITH CHECK (public.app_is_platform_admin());
CREATE POLICY mattsystem_business_addons_delete_admin
  ON public.app_business_addons FOR DELETE TO PUBLIC
  USING (public.app_is_platform_admin());

INSERT INTO public.schema_migrations(version)
VALUES ('038_platform_managed_entitlements')
ON CONFLICT (version) DO NOTHING;

COMMIT;
