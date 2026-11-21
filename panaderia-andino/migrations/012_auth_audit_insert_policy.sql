-- Permitir registrar intentos de autenticación anónimos sin abrir auditoría de tenants.
-- Solo permite INSERT de eventos de login fallido/bloqueado sin identidad ni negocio.
DROP POLICY IF EXISTS mattsystem_auth_audit_insert ON public.app_audit_logs;
CREATE POLICY mattsystem_auth_audit_insert
  ON public.app_audit_logs
  FOR INSERT
  TO mattsystem_app
  WITH CHECK (
    business_id IS NULL
    AND actor_user_id IS NULL
    AND action IN ('auth.login_failed', 'auth.login_blocked')
  );

INSERT INTO public.schema_migrations(version)
VALUES ('012_auth_audit_insert_policy')
ON CONFLICT (version) DO NOTHING;
