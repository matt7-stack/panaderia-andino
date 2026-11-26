-- 041: limitar lectura y gestión de notificaciones a su destinatario.
-- La inserción sigue permitiendo que el backend genere avisos para otro usuario del mismo negocio.
BEGIN;

DROP POLICY IF EXISTS mattsystem_tenant_select ON public.app_notifications;
CREATE POLICY mattsystem_notifications_user_select
  ON public.app_notifications FOR SELECT TO PUBLIC
  USING (
    public.app_is_platform_admin()
    OR (business_id = public.app_current_business_id()
        AND user_id = public.app_context_user_id())
  );

DROP POLICY IF EXISTS mattsystem_tenant_update ON public.app_notifications;
CREATE POLICY mattsystem_notifications_user_update
  ON public.app_notifications FOR UPDATE TO PUBLIC
  USING (
    public.app_is_platform_admin()
    OR (business_id = public.app_current_business_id()
        AND user_id = public.app_context_user_id())
  )
  WITH CHECK (
    public.app_is_platform_admin()
    OR (business_id = public.app_current_business_id()
        AND user_id = public.app_context_user_id())
  );

DROP POLICY IF EXISTS mattsystem_tenant_delete ON public.app_notifications;
CREATE POLICY mattsystem_notifications_user_delete
  ON public.app_notifications FOR DELETE TO PUBLIC
  USING (
    public.app_is_platform_admin()
    OR (business_id = public.app_current_business_id()
        AND user_id = public.app_context_user_id())
  );

INSERT INTO public.schema_migrations(version)
VALUES ('041_user_scoped_notifications_rls')
ON CONFLICT (version) DO NOTHING;

COMMIT;
