-- 055: restrict tenant acknowledgement to the exact assigned release.
-- Platform administrators retain full control; business sessions can only
-- acknowledge an already assigned release and cannot approve or mark payments.
BEGIN;

CREATE OR REPLACE FUNCTION public.app_guard_business_version_tenant_ack()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF public.app_is_platform_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.target_release_id IS DISTINCT FROM OLD.target_release_id
     OR NEW.updated_by IS DISTINCT FROM OLD.updated_by
     OR NEW.installed_release_id IS DISTINCT FROM OLD.target_release_id
     OR NEW.assigned_at < OLD.assigned_at THEN
    RAISE EXCEPTION 'El negocio solo puede confirmar la versión que ya tiene asignada.'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS app_business_versions_tenant_ack_guard
  ON public.app_business_versions;
CREATE TRIGGER app_business_versions_tenant_ack_guard
BEFORE UPDATE ON public.app_business_versions
FOR EACH ROW EXECUTE FUNCTION public.app_guard_business_version_tenant_ack();

CREATE OR REPLACE FUNCTION public.app_guard_version_upgrade_tenant_ack()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF public.app_is_platform_admin() THEN
    RETURN NEW;
  END IF;
  IF OLD.status <> 'paid'
     OR NEW.status <> 'applied'
     OR NEW.applied_at IS NULL
     OR (to_jsonb(NEW) - ARRAY['status','applied_at','updated_at'])
        IS DISTINCT FROM
        (to_jsonb(OLD) - ARRAY['status','applied_at','updated_at']) THEN
    RAISE EXCEPTION 'El negocio solo puede confirmar la instalación de una mejora pagada.'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS app_version_upgrade_tenant_ack_guard
  ON public.app_version_upgrade_requests;
CREATE TRIGGER app_version_upgrade_tenant_ack_guard
BEFORE UPDATE ON public.app_version_upgrade_requests
FOR EACH ROW EXECUTE FUNCTION public.app_guard_version_upgrade_tenant_ack();

CREATE OR REPLACE FUNCTION public.app_guard_business_version_history_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE assigned app_business_versions%ROWTYPE;
BEGIN
  IF public.app_is_platform_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.business_id IS DISTINCT FROM public.app_current_business_id()
     OR NEW.change_reason <> 'runtime_acknowledged'
     OR (NEW.changed_by IS NOT NULL AND NEW.changed_by IS DISTINCT FROM public.app_context_user_id()) THEN
    RAISE EXCEPTION 'El negocio solo puede registrar la confirmación de instalación de su versión asignada.'
      USING ERRCODE='42501';
  END IF;
  SELECT * INTO assigned FROM public.app_business_versions
    WHERE business_id=NEW.business_id LIMIT 1;
  IF NOT FOUND
     OR NEW.from_release_id IS DISTINCT FROM assigned.installed_release_id
     OR NEW.to_release_id IS DISTINCT FROM assigned.target_release_id
     OR NOT EXISTS (
       SELECT 1 FROM public.app_releases r
       WHERE r.id=NEW.to_release_id AND r.status='published' AND r.delivery_ready=TRUE
     ) THEN
    RAISE EXCEPTION 'El historial no coincide con una versión publicada y asignada.'
      USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS app_business_version_history_tenant_guard
  ON public.app_business_version_history;
CREATE TRIGGER app_business_version_history_tenant_guard
BEFORE INSERT ON public.app_business_version_history
FOR EACH ROW EXECUTE FUNCTION public.app_guard_business_version_history_insert();

INSERT INTO public.schema_migrations(version)
VALUES ('055_version_acknowledgement_guards')
ON CONFLICT (version) DO NOTHING;

COMMIT;
