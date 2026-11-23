-- 013: idempotency and complete customer names for optional receivables.
ALTER TABLE app_customers ADD COLUMN IF NOT EXISTS last_name TEXT NOT NULL DEFAULT '';
ALTER TABLE app_receivable_debts ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS app_receivable_debts_business_idempotency_key_key
  ON app_receivable_debts(business_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
INSERT INTO schema_migrations(version) VALUES('013_receivables_idempotency')
ON CONFLICT(version) DO NOTHING;
