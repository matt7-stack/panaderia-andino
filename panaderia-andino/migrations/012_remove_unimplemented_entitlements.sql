-- 012: do not grandfather modules that are not implemented.
BEGIN;
UPDATE app_business_config
SET modules=(modules - 'branches' - 'delivery'),updated_at=NOW()
WHERE modules ? 'branches' OR modules ? 'delivery';
INSERT INTO schema_migrations(version) VALUES('012_remove_unimplemented_entitlements')
ON CONFLICT(version) DO NOTHING;
COMMIT;