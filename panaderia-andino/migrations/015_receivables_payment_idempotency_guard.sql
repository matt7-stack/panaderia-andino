-- 015: make receivable payment idempotency safe before balance validation.
CREATE OR REPLACE FUNCTION public.app_receivables_guard_payment()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  debt_row app_receivable_debts%ROWTYPE;
  paid_total NUMERIC(14,2);
BEGIN
  IF TG_OP='INSERT' AND NEW.idempotency_key IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.business_id::text || ':' || NEW.idempotency_key,0));
    IF EXISTS (
      SELECT 1 FROM app_receivable_payments
      WHERE business_id=NEW.business_id AND idempotency_key=NEW.idempotency_key
    ) THEN
      RETURN NULL;
    END IF;
  END IF;

  SELECT * INTO debt_row FROM app_receivable_debts
   WHERE business_id=NEW.business_id AND id=NEW.debt_id FOR UPDATE;
  IF NOT FOUND OR debt_row.status='cancelled' THEN
    RAISE EXCEPTION 'La deuda no existe o está anulada.' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' AND NOT EXISTS (
      SELECT 1 FROM app_business_addons a
      JOIN app_module_catalog m ON m.module_key=a.module_key
      WHERE a.business_id=NEW.business_id AND a.module_key='receivables'
        AND a.contracted=TRUE AND a.enabled=TRUE AND a.status='active'
        AND m.active=TRUE AND m.implemented=TRUE AND m.commercial_mode='addon'
    ) THEN
    RAISE EXCEPTION 'El complemento de cuentas por cobrar no está habilitado.' USING ERRCODE='42501';
  END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.actor_user_id IS NULL OR NOT EXISTS(
      SELECT 1 FROM app_users u WHERE u.id=NEW.actor_user_id AND u.business_id=NEW.business_id
        AND u.is_platform_admin=FALSE AND u.active=TRUE
    ) THEN
      RAISE EXCEPTION 'El usuario que registra el pago no pertenece al negocio o está inactivo.' USING ERRCODE='42501';
    END IF;
    IF NOT (
      COALESCE((SELECT CASE WHEN jsonb_typeof(st.data->'paymentMethods')='array'
        THEN st.data->'paymentMethods' ELSE '["Efectivo","Transferencia","Tarjeta","QR"]'::jsonb END
        FROM app_state st WHERE st.business_id=NEW.business_id LIMIT 1),
        '["Efectivo","Transferencia","Tarjeta","QR"]'::jsonb)
      @> jsonb_build_array(NEW.payment_method)
    ) THEN
      RAISE EXCEPTION 'El método de pago no está habilitado para este negocio.' USING ERRCODE='23514';
    END IF;
    SELECT COALESCE(SUM(amount),0) INTO paid_total
      FROM app_receivable_payments
      WHERE business_id=NEW.business_id AND debt_id=NEW.debt_id AND status='active';
    IF NEW.amount > debt_row.amount-paid_total THEN
      RAISE EXCEPTION 'El pago supera el saldo pendiente.' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.business_id<>NEW.business_id OR OLD.debt_id<>NEW.debt_id OR
     OLD.amount<>NEW.amount OR OLD.payment_method<>NEW.payment_method OR
     OLD.paid_at<>NEW.paid_at OR OLD.idempotency_key<>NEW.idempotency_key OR
     OLD.actor_user_id IS DISTINCT FROM NEW.actor_user_id THEN
    RAISE EXCEPTION 'Los datos de un pago son inmutables; registrá una anulación auditada.' USING ERRCODE='23514';
  END IF;
  IF OLD.status='reversed' OR NEW.status<>'reversed' OR NEW.reversed_at IS NULL OR NEW.reversed_by IS NULL OR
     NOT EXISTS(SELECT 1 FROM app_users u WHERE u.id=NEW.reversed_by AND u.business_id=NEW.business_id
       AND u.is_platform_admin=FALSE AND u.active=TRUE) THEN
    RAISE EXCEPTION 'Transición de pago o usuario anulador no permitido.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$function$;
INSERT INTO schema_migrations(version) VALUES('015_receivables_payment_idempotency_guard')
ON CONFLICT(version) DO NOTHING;
