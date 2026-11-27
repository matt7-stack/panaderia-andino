-- 056: per-business trusted device registry and tenant-safe device limits.
BEGIN;

CREATE TABLE IF NOT EXISTS public.app_device_registrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.app_users(id) ON DELETE SET NULL,
  device_hash char(64) NOT NULL,
  label text NOT NULL DEFAULT 'Dispositivo',
  first_seen_at timestamptz NOT NULL DEFAULT NOW(),
  last_seen_at timestamptz NOT NULL DEFAULT NOW(),
  revoked_at timestamptz,
  CONSTRAINT app_device_registrations_hash_check CHECK (device_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT app_device_registrations_business_hash_key UNIQUE (business_id, device_hash)
);
CREATE INDEX IF NOT EXISTS app_device_registrations_business_active_idx
  ON public.app_device_registrations(business_id, last_seen_at DESC)
  WHERE revoked_at IS NULL;

ALTER TABLE public.app_device_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_device_registrations FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mattsystem_devices_select ON public.app_device_registrations;
DROP POLICY IF EXISTS mattsystem_devices_insert ON public.app_device_registrations;
DROP POLICY IF EXISTS mattsystem_devices_update ON public.app_device_registrations;
DROP POLICY IF EXISTS mattsystem_devices_delete ON public.app_device_registrations;
CREATE POLICY mattsystem_devices_select ON public.app_device_registrations
  FOR SELECT USING (public.app_is_platform_admin() OR business_id = public.app_current_business_id());
CREATE POLICY mattsystem_devices_insert ON public.app_device_registrations
  FOR INSERT WITH CHECK (public.app_is_platform_admin() OR business_id = public.app_current_business_id());
CREATE POLICY mattsystem_devices_update ON public.app_device_registrations
  FOR UPDATE USING (public.app_is_platform_admin() OR business_id = public.app_current_business_id())
  WITH CHECK (public.app_is_platform_admin() OR business_id = public.app_current_business_id());
CREATE POLICY mattsystem_devices_delete ON public.app_device_registrations
  FOR DELETE USING (public.app_is_platform_admin() OR business_id = public.app_current_business_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_device_registrations TO mattsystem_runtime;
INSERT INTO public.schema_migrations(version)
VALUES ('056_device_registration_and_limits')
ON CONFLICT (version) DO NOTHING;

COMMIT;
