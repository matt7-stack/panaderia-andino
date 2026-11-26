-- MATTSYSTEM QA hardening: immutable audit history and platform-owned quotations.
-- Safe to re-run. No application/business rows are deleted or modified.
ALTER POLICY mattsystem_tenant_update ON public.app_audit_logs
  USING (public.app_is_platform_admin())
  WITH CHECK (public.app_is_platform_admin());

ALTER POLICY mattsystem_tenant_delete ON public.app_audit_logs
  USING (public.app_is_platform_admin());

ALTER POLICY mattsystem_tenant_delete ON public.app_quotations
  USING (public.app_is_platform_admin());

INSERT INTO public.schema_migrations(version)
VALUES ('042_audit_log_immutability_and_quote_delete_scope')
ON CONFLICT (version) DO NOTHING;
