BEGIN;

-- Normaliza roles preexistentes que pudieron crearse con LOGIN antes de aplicar RLS.
-- El usuario de conexión conserva permiso SET al rol, pero el rol de runtime no acepta
-- conexiones directas ni hereda privilegios fuera de cada transacción.
DO $role_guard$
DECLARE unsafe_role boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mattsystem_app') THEN
    RAISE EXCEPTION 'Falta mattsystem_app; aplicar primero las migraciones 008-010';
  END IF;
  SELECT rolsuper OR rolbypassrls INTO unsafe_role
  FROM pg_roles WHERE rolname='mattsystem_app';
  IF COALESCE(unsafe_role,TRUE) THEN
    RAISE EXCEPTION 'mattsystem_app no puede ser SUPERUSER ni BYPASSRLS';
  END IF;
END
$role_guard$;

ALTER ROLE mattsystem_app NOLOGIN NOINHERIT;
GRANT mattsystem_app TO panaderia_owner WITH INHERIT FALSE, SET TRUE;

INSERT INTO public.schema_migrations(version)
VALUES ('014_lock_down_runtime_role')
ON CONFLICT (version) DO NOTHING;

COMMIT;
