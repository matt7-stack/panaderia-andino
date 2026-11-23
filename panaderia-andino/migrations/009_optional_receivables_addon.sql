-- 009: optional Cuentas por cobrar addon, isolated per business.
-- This migration is intentionally separate from core ERP modules and never activates the addon for a business.

INSERT INTO app_module_catalog(module_key,title,description,category,monthly_price,setup_price,active,sort_order,implemented,commercial_mode)
VALUES('receivables','Cuentas por cobrar','Clientes que compran fiado, deudas, pagos parciales y saldos pendientes','finanzas',0,0,TRUE,180,TRUE,'addon')
ON CONFLICT(module_key) DO UPDATE SET
  title=EXCLUDED.title,
  description=EXCLUDED.description,
  category=EXCLUDED.category,
  implemented=TRUE,
  commercial_mode='addon',
  sort_order=EXCLUDED.sort_order;

ALTER TABLE app_financial_entries ADD COLUMN IF NOT EXISTS receivable_payment_id uuid;
ALTER TABLE app_financial_entries ADD COLUMN IF NOT EXISTS receivable_action text;
ALTER TABLE app_cash_movements ADD COLUMN IF NOT EXISTS receivable_payment_id uuid;
ALTER TABLE app_cash_movements ADD COLUMN IF NOT EXISTS receivable_action text;

CREATE TABLE IF NOT EXISTS app_receivable_debts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL,
  description text NOT NULL,
  amount numeric NOT NULL CHECK(amount>0),
  due_date date NULL,
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','paid','cancelled')),
  actor_user_id uuid NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_receivable_debts_business_id_id_key UNIQUE(business_id,id),
  CONSTRAINT app_receivable_debts_business_id_customer_id_fkey
    FOREIGN KEY(business_id,customer_id) REFERENCES app_customers(business_id,id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS app_receivable_debts_business_customer_idx
  ON app_receivable_debts(business_id,customer_id,created_at DESC);
CREATE INDEX IF NOT EXISTS app_receivable_debts_business_due_idx
  ON app_receivable_debts(business_id,due_date) WHERE status='open';

CREATE TABLE IF NOT EXISTS app_receivable_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  debt_id uuid NOT NULL,
  amount numeric NOT NULL CHECK(amount>0),
  paid_at timestamptz NOT NULL DEFAULT now(),
  payment_method text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','reversed')),
  actor_user_id uuid NULL REFERENCES app_users(id) ON DELETE SET NULL,
  reversed_by uuid NULL REFERENCES app_users(id) ON DELETE SET NULL,
  reversed_at timestamptz NULL,
  reversal_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_receivable_payments_business_id_id_key UNIQUE(business_id,id),
  CONSTRAINT app_receivable_payments_business_id_idempotency_key_key UNIQUE(business_id,idempotency_key),
  CONSTRAINT app_receivable_payments_business_id_debt_id_fkey
    FOREIGN KEY(business_id,debt_id) REFERENCES app_receivable_debts(business_id,id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS app_receivable_payments_business_debt_idx
  ON app_receivable_payments(business_id,debt_id,paid_at DESC);

CREATE TABLE IF NOT EXISTS app_receivable_audit (
  id bigserial PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
  debt_id uuid NOT NULL,
  payment_id uuid NULL,
  actor_user_id uuid NULL REFERENCES app_users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT app_receivable_audit_business_id_debt_id_fkey
    FOREIGN KEY(business_id,debt_id) REFERENCES app_receivable_debts(business_id,id) ON DELETE RESTRICT,
  CONSTRAINT app_receivable_audit_business_id_payment_id_fkey
    FOREIGN KEY(business_id,payment_id) REFERENCES app_receivable_payments(business_id,id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS app_receivable_audit_business_debt_idx
  ON app_receivable_audit(business_id,debt_id,created_at DESC);

ALTER TABLE app_financial_entries
  ADD CONSTRAINT app_financial_entries_receivable_payment_fk
  FOREIGN KEY(business_id,receivable_payment_id)
  REFERENCES app_receivable_payments(business_id,id) ON DELETE RESTRICT;
ALTER TABLE app_financial_entries
  ADD CONSTRAINT app_financial_entries_receivable_action_check
  CHECK(receivable_action IS NULL OR receivable_action IN ('payment','reversal'));
CREATE UNIQUE INDEX IF NOT EXISTS app_financial_entries_receivable_once_idx
  ON app_financial_entries(business_id,receivable_payment_id,receivable_action)
  WHERE receivable_payment_id IS NOT NULL;

ALTER TABLE app_cash_movements
  ADD CONSTRAINT app_cash_movements_receivable_payment_fk
  FOREIGN KEY(business_id,receivable_payment_id)
  REFERENCES app_receivable_payments(business_id,id) ON DELETE RESTRICT;
ALTER TABLE app_cash_movements
  ADD CONSTRAINT app_cash_movements_receivable_action_check
  CHECK(receivable_action IS NULL OR receivable_action IN ('payment','reversal'));
CREATE UNIQUE INDEX IF NOT EXISTS app_cash_movements_receivable_once_idx
  ON app_cash_movements(business_id,receivable_payment_id,receivable_action)
  WHERE receivable_payment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.app_receivables_guard_debt_update()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE paid_total NUMERIC(14,2);
BEGIN
  IF TG_OP='INSERT' THEN
    IF NOT EXISTS (
      SELECT 1 FROM app_business_addons a JOIN app_module_catalog m ON m.module_key=a.module_key
      WHERE a.business_id=NEW.business_id AND a.module_key='receivables'
        AND a.contracted=TRUE AND a.enabled=TRUE AND a.status='active'
        AND m.active=TRUE AND m.implemented=TRUE AND m.commercial_mode='addon'
    ) THEN
      RAISE EXCEPTION 'El complemento de cuentas por cobrar no está habilitado.' USING ERRCODE='42501';
    END IF;
    IF NEW.actor_user_id IS NULL OR NOT EXISTS(
      SELECT 1 FROM app_users u WHERE u.id=NEW.actor_user_id AND u.business_id=NEW.business_id
        AND u.is_platform_admin=FALSE AND u.active=TRUE
    ) THEN
      RAISE EXCEPTION 'El usuario que registra la deuda no pertenece al negocio o está inactivo.' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.business_id<>NEW.business_id OR OLD.customer_id<>NEW.customer_id OR
     OLD.actor_user_id IS DISTINCT FROM NEW.actor_user_id THEN
    RAISE EXCEPTION 'No se puede trasladar una deuda a otro negocio o cliente ni cambiar su autor.' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM app_business_addons a JOIN app_module_catalog m ON m.module_key=a.module_key
    WHERE a.business_id=NEW.business_id AND a.module_key='receivables'
      AND a.contracted=TRUE AND a.enabled=TRUE AND a.status='active'
      AND m.active=TRUE AND m.implemented=TRUE AND m.commercial_mode='addon'
  ) THEN
    RAISE EXCEPTION 'El complemento de cuentas por cobrar no está habilitado.' USING ERRCODE='42501';
  END IF;
  IF NEW.actor_user_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM app_users u WHERE u.id=NEW.actor_user_id AND u.business_id=NEW.business_id
      AND u.is_platform_admin=FALSE AND u.active=TRUE
  ) THEN
    RAISE EXCEPTION 'El usuario que modifica la deuda no pertenece al negocio o está inactivo.' USING ERRCODE='42501';
  END IF;
  SELECT COALESCE(SUM(amount),0) INTO paid_total FROM app_receivable_payments
    WHERE business_id=OLD.business_id AND debt_id=OLD.id AND status='active';
  IF NEW.amount<paid_total THEN
    RAISE EXCEPTION 'El importe no puede ser inferior a los pagos ya recibidos.' USING ERRCODE='23514';
  END IF;
  IF OLD.status='cancelled' AND NEW.status<>'cancelled' THEN
    RAISE EXCEPTION 'Una deuda anulada no se puede reactivar.' USING ERRCODE='23514';
  END IF;
  IF NEW.status='cancelled' AND paid_total>0 THEN
    RAISE EXCEPTION 'No se puede anular una deuda con pagos activos.' USING ERRCODE='23514';
  END IF;
  IF NEW.status='paid' AND paid_total<NEW.amount THEN
    RAISE EXCEPTION 'La deuda no puede marcarse pagada si conserva saldo.' USING ERRCODE='23514';
  END IF;
  IF NEW.status='open' AND paid_total>=NEW.amount THEN
    RAISE EXCEPTION 'La deuda debe figurar pagada cuando no conserva saldo.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.app_receivables_guard_payment()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  debt_row app_receivable_debts%ROWTYPE;
  paid_total NUMERIC(14,2);
BEGIN
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

CREATE OR REPLACE FUNCTION public.app_receivables_sync_payment_finance()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  debt_description TEXT;
  cash_session UUID;
  entry_kind TEXT;
  action_kind TEXT;
  amount_value NUMERIC(14,2);
  description_value TEXT;
BEGIN
  SELECT description INTO debt_description FROM app_receivable_debts
   WHERE business_id=NEW.business_id AND id=NEW.debt_id;
  IF TG_OP='INSERT' THEN
    entry_kind:='income'; action_kind:='payment'; amount_value:=NEW.amount;
    description_value:='Cobro de cuenta por cobrar: '||COALESCE(debt_description,'Deuda');
  ELSE
    entry_kind:='expense'; action_kind:='reversal'; amount_value:=NEW.amount;
    description_value:='Anulación de cobro de cuenta por cobrar: '||COALESCE(debt_description,'Deuda');
  END IF;

  INSERT INTO app_financial_entries(
    business_id,entry_type,category,description,amount,payment_method,reference,paid_at,actor_user_id,
    receivable_payment_id,receivable_action
  ) VALUES (
    NEW.business_id,entry_kind,'Cuentas por cobrar',description_value,amount_value,
    NEW.payment_method,'CC-'||NEW.id::text,CASE WHEN action_kind='payment' THEN NEW.paid_at ELSE NEW.reversed_at END,
    CASE WHEN action_kind='payment' THEN NEW.actor_user_id ELSE NEW.reversed_by END,
    NEW.id,action_kind
  );

  IF lower(btrim(NEW.payment_method)) IN ('efectivo','cash') THEN
    SELECT id INTO cash_session FROM app_cash_sessions
      WHERE business_id=NEW.business_id AND status='open'
      ORDER BY opened_at DESC LIMIT 1 FOR UPDATE;
    IF cash_session IS NOT NULL THEN
      INSERT INTO app_cash_movements(
        business_id,cash_session_id,movement_type,category,description,amount,payment_method,reference,actor_user_id,
        receivable_payment_id,receivable_action
      ) VALUES (
        NEW.business_id,cash_session,entry_kind,'Cuentas por cobrar',description_value,amount_value,
        NEW.payment_method,'CC-'||NEW.id::text,
        CASE WHEN action_kind='payment' THEN NEW.actor_user_id ELSE NEW.reversed_by END,
        NEW.id,action_kind
      );
    END IF;
  END IF;

  IF TG_OP='INSERT' THEN
    UPDATE app_receivable_debts SET
      status=CASE WHEN (SELECT COALESCE(SUM(amount),0) FROM app_receivable_payments
        WHERE business_id=NEW.business_id AND debt_id=NEW.debt_id AND status='active')>=amount
        THEN 'paid' ELSE 'open' END,
      updated_at=NOW()
    WHERE business_id=NEW.business_id AND id=NEW.debt_id;
    INSERT INTO app_receivable_audit(business_id,debt_id,payment_id,actor_user_id,event_type,details)
    VALUES(NEW.business_id,NEW.debt_id,NEW.id,NEW.actor_user_id,'payment_recorded',
      jsonb_build_object('amount',NEW.amount,'payment_method',NEW.payment_method,'paid_at',NEW.paid_at));
  ELSE
    UPDATE app_receivable_debts SET status='open',updated_at=NOW()
      WHERE business_id=NEW.business_id AND id=NEW.debt_id AND status='paid';
    INSERT INTO app_receivable_audit(business_id,debt_id,payment_id,actor_user_id,event_type,details)
    VALUES(NEW.business_id,NEW.debt_id,NEW.id,NEW.reversed_by,'payment_reversed',
      jsonb_build_object('amount',NEW.amount,'reason',NEW.reversal_reason,'reversed_at',NEW.reversed_at));
  END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS app_receivable_debts_guard_insert_update ON app_receivable_debts;
CREATE TRIGGER app_receivable_debts_guard_insert_update
BEFORE INSERT OR UPDATE ON app_receivable_debts
FOR EACH ROW EXECUTE FUNCTION app_receivables_guard_debt_update();

DROP TRIGGER IF EXISTS app_receivable_payments_guard_insert_update ON app_receivable_payments;
CREATE TRIGGER app_receivable_payments_guard_insert_update
BEFORE INSERT OR UPDATE ON app_receivable_payments
FOR EACH ROW EXECUTE FUNCTION app_receivables_guard_payment();

DROP TRIGGER IF EXISTS app_receivable_payments_sync_finance_insert ON app_receivable_payments;
CREATE TRIGGER app_receivable_payments_sync_finance_insert
AFTER INSERT ON app_receivable_payments
FOR EACH ROW EXECUTE FUNCTION app_receivables_sync_payment_finance();

DROP TRIGGER IF EXISTS app_receivable_payments_sync_finance_update ON app_receivable_payments;
CREATE TRIGGER app_receivable_payments_sync_finance_update
AFTER UPDATE ON app_receivable_payments
FOR EACH ROW EXECUTE FUNCTION app_receivables_sync_payment_finance();

INSERT INTO schema_migrations(version) VALUES('009_optional_receivables_addon')
ON CONFLICT(version) DO NOTHING;
