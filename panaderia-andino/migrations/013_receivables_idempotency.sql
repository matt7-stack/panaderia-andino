-- 013: idempotency and complete customer names for optional receivables.
BEGIN;
ALTER TABLE app_customers ADD COLUMN IF NOT EXISTS last_name TEXT NOT NULL DEFAULT '';
ALTER TABLE app_receivable_debts ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS app_receivable_debts_business_idempotency_key_key
  ON app_receivable_debts(business_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='app_receivable_debts_idempotency_key_length') THEN
    ALTER TABLE app_receivable_debts ADD CONSTRAINT app_receivable_debts_idempotency_key_length
      CHECK (idempotency_key IS NULL OR length(btrim(idempotency_key)) BETWEEN 8 AND 128) NOT VALID;
  END IF;
END $$;
ALTER TABLE app_receivable_debts VALIDATE CONSTRAINT app_receivable_debts_idempotency_key_length;
INSERT INTO schema_migrations(version) VALUES('013_receivables_idempotency')
ON CONFLICT(version) DO NOTHING;
COMMIT;
