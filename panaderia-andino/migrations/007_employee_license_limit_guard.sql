BEGIN;

-- Contador mantenido por la base para que el límite de empleados no dependa
-- de un COUNT seguido de INSERT desde dos solicitudes concurrentes.
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS active_employee_count integer NOT NULL DEFAULT 0;

UPDATE businesses b
SET active_employee_count = (
  SELECT COUNT(*)::integer
  FROM app_users u
  WHERE u.business_id=b.id
    AND u.role='employee'
    AND u.active=TRUE
    AND u.is_platform_admin=FALSE
);

CREATE OR REPLACE FUNCTION maintain_business_employee_license_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  old_counted boolean := FALSE;
  new_counted boolean := FALSE;
  v_limit integer;
  v_updated_count integer;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    old_counted := OLD.role='employee' AND OLD.active=TRUE AND OLD.is_platform_admin=FALSE;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    new_counted := NEW.role='employee' AND NEW.active=TRUE AND NEW.is_platform_admin=FALSE;
  END IF;

  IF TG_OP='DELETE' THEN
    IF old_counted THEN
      UPDATE businesses
      SET active_employee_count=GREATEST(0,active_employee_count-1),updated_at=NOW()
      WHERE id=OLD.business_id;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP='UPDATE'
     AND old_counted AND new_counted
     AND OLD.business_id IS NOT DISTINCT FROM NEW.business_id THEN
    RETURN NEW;
  END IF;

  IF old_counted THEN
    UPDATE businesses
    SET active_employee_count=GREATEST(0,active_employee_count-1),updated_at=NOW()
    WHERE id=OLD.business_id;
  END IF;

  IF new_counted THEN
    SELECT CASE
      WHEN l.id IS NULL THEN 1
      ELSE COALESCE(l.user_limit,
        CASE l.plan WHEN 'basic' THEN 1 WHEN 'professional' THEN 4 ELSE NULL END)
    END
    INTO v_limit
    FROM (SELECT NEW.business_id AS business_id) target
    LEFT JOIN LATERAL (
      SELECT id,plan,user_limit
      FROM app_licenses
      WHERE business_id=target.business_id
        AND status='active'
        AND (expires_at IS NULL OR expires_at>=CURRENT_DATE)
      ORDER BY created_at DESC
      LIMIT 1
    ) l ON TRUE;

    -- El UPDATE condicional serializa altas concurrentes en la fila del negocio.
    UPDATE businesses
    SET active_employee_count=active_employee_count+1,updated_at=NOW()
    WHERE id=NEW.business_id
      AND (v_limit IS NULL OR active_employee_count < v_limit)
    RETURNING active_employee_count INTO v_updated_count;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'employee_license_limit_reached'
        USING ERRCODE='23514', CONSTRAINT='app_users_employee_license_limit';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS app_users_employee_license_limit ON app_users;
CREATE TRIGGER app_users_employee_license_limit
AFTER INSERT OR UPDATE OF business_id,role,active,is_platform_admin OR DELETE
ON app_users
FOR EACH ROW
EXECUTE FUNCTION maintain_business_employee_license_limit();

INSERT INTO schema_migrations(version)
VALUES ('007_employee_license_limit_guard')
ON CONFLICT (version) DO NOTHING;

COMMIT;
