BEGIN;

-- La conexión DATABASE_URL usa panaderia_owner, que tiene BYPASSRLS.
-- Cada transacción autenticada debe poder cambiar explícitamente al rol sin BYPASSRLS.
-- Se conserva INHERIT FALSE para evitar herencia implícita fuera de las transacciones
-- y se habilita SET TRUE para que la API ejecute SET LOCAL ROLE de forma transaccional.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mattsystem_app') THEN
    RAISE EXCEPTION 'Falta el rol mattsystem_app; aplicar primero las migraciones 008-010';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'panaderia_owner') THEN
    RAISE EXCEPTION 'Falta el rol de conexión panaderia_owner; revisar DATABASE_URL';
  END IF;
END
$migration$;

GRANT mattsystem_app TO panaderia_owner WITH INHERIT FALSE, SET TRUE;

INSERT INTO public.schema_migrations(version)
VALUES ('011_runtime_role_set_option')
ON CONFLICT (version) DO NOTHING;

COMMIT;
