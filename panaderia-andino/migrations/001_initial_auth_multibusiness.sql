-- Gestión Panadería: esquema inicial de autenticación multi-panadería.
-- Ejecutar una sola vez en la base nueva gestion_panaderia.
BEGIN;
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.businesses (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.app_users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin','supervisor','employee')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  business_id uuid REFERENCES public.businesses(id) ON DELETE RESTRICT,
  is_platform_admin boolean NOT NULL DEFAULT false,
  session_version integer NOT NULL DEFAULT 0,
  CONSTRAINT app_users_platform_admin_scope CHECK (
    (is_platform_admin = true AND business_id IS NULL) OR
    (is_platform_admin = false AND business_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS app_users_email_lower_uq ON public.app_users (lower(email));
CREATE INDEX IF NOT EXISTS app_users_business_id_idx ON public.app_users(business_id);
CREATE INDEX IF NOT EXISTS app_users_active_idx ON public.app_users(active);
CREATE TABLE IF NOT EXISTS public.app_state (
  id smallserial PRIMARY KEY,
  data jsonb NOT NULL,
  updated_by uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  business_id uuid NOT NULL UNIQUE REFERENCES public.businesses(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS public.app_login_attempts (
  email text PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.admin_password_resets (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_password_resets_user_id_idx ON public.admin_password_resets(user_id);
INSERT INTO public.schema_migrations(version) VALUES ('001_initial_auth_multibusiness')
ON CONFLICT (version) DO NOTHING;
COMMIT;
