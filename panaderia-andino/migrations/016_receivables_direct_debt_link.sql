-- 016: explicitly link receivable finance and cash entries to the originating debt.
ALTER TABLE app_financial_entries ADD COLUMN IF NOT EXISTS receivable_debt_id uuid;
ALTER TABLE app_cash_movements ADD COLUMN IF NOT EXISTS receivable_debt_id uuid;
ALTER TABLE app_financial_entries ADD CONSTRAINT app_financial_entries_receivable_debt_fk
  FOREIGN KEY(business_id,receivable_debt_id) REFERENCES app_receivable_debts(business_id,id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS app_financial_entries_receivable_debt_idx
  ON app_financial_entries(business_id,receivable_debt_id) WHERE receivable_debt_id IS NOT NULL;
ALTER TABLE app_cash_movements ADD CONSTRAINT app_cash_movements_receivable_debt_fk
  FOREIGN KEY(business_id,receivable_debt_id) REFERENCES app_receivable_debts(business_id,id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS app_cash_movements_receivable_debt_idx
  ON app_cash_movements(business_id,receivable_debt_id) WHERE receivable_debt_id IS NOT NULL;
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
    receivable_debt_id,receivable_payment_id,receivable_action
  ) VALUES (
    NEW.business_id,entry_kind,'Cuentas por cobrar',description_value,amount_value,
    NEW.payment_method,'CC-'||NEW.id::text,CASE WHEN action_kind='payment' THEN NEW.paid_at ELSE NEW.reversed_at END,
    CASE WHEN action_kind='payment' THEN NEW.actor_user_id ELSE NEW.reversed_by END,
    NEW.debt_id,NEW.id,action_kind
  );

  IF lower(btrim(NEW.payment_method)) IN ('efectivo','cash') THEN
    SELECT id INTO cash_session FROM app_cash_sessions
      WHERE business_id=NEW.business_id AND status='open'
      ORDER BY opened_at DESC LIMIT 1 FOR UPDATE;
    IF cash_session IS NOT NULL THEN
      INSERT INTO app_cash_movements(
        business_id,cash_session_id,movement_type,category,description,amount,payment_method,reference,actor_user_id,
        receivable_debt_id,receivable_payment_id,receivable_action
      ) VALUES (
        NEW.business_id,cash_session,entry_kind,'Cuentas por cobrar',description_value,amount_value,
        NEW.payment_method,'CC-'||NEW.id::text,
        CASE WHEN action_kind='payment' THEN NEW.actor_user_id ELSE NEW.reversed_by END,
        NEW.debt_id,NEW.id,action_kind
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
INSERT INTO schema_migrations(version) VALUES('016_receivables_direct_debt_link')
ON CONFLICT(version) DO NOTHING;
