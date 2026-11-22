-- 011: distinguish a new-business quote from a module-expansion quote.
BEGIN;
ALTER TABLE app_quotations ADD COLUMN IF NOT EXISTS is_module_expansion BOOLEAN NOT NULL DEFAULT FALSE;
INSERT INTO schema_migrations(version) VALUES('011_module_expansion_quotes')
ON CONFLICT(version) DO NOTHING;
COMMIT;