-- 044: suscripciones Web Push privadas por usuario y dispositivo.
BEGIN;
CREATE TABLE IF NOT EXISTS public.app_push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  subscription jsonb NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT NOW(),
  updated_at timestamptz NOT NULL DEFAULT NOW(),
  last_success_at timestamptz
);
CREATE INDEX IF NOT EXISTS app_push_subscriptions_user_idx ON public.app_push_subscriptions(user_id);
ALTER TABLE public.app_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_push_subscriptions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mattsystem_push_subscriptions_user_all ON public.app_push_subscriptions;
CREATE POLICY mattsystem_push_subscriptions_user_all ON public.app_push_subscriptions
  FOR ALL TO PUBLIC
  USING (public.app_is_platform_admin() OR (user_id=public.app_context_user_id() AND business_id IS NOT DISTINCT FROM public.app_current_business_id()))
  WITH CHECK (public.app_is_platform_admin() OR (user_id=public.app_context_user_id() AND business_id IS NOT DISTINCT FROM public.app_current_business_id()));
INSERT INTO public.schema_migrations(version) VALUES ('044_web_push_subscriptions') ON CONFLICT(version) DO NOTHING;
COMMIT;
