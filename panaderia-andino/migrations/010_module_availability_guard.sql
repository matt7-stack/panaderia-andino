-- 010: keep not-yet-built expansion modules out of commercial packages.
BEGIN;
ALTER TABLE app_module_catalog ADD COLUMN IF NOT EXISTS implemented BOOLEAN NOT NULL DEFAULT TRUE;
UPDATE app_module_catalog SET implemented=FALSE,active=FALSE,updated_at=NOW()
WHERE module_key IN ('branches','delivery');
UPDATE app_industry_templates SET enabled_by_default=FALSE
WHERE module_key IN ('branches','delivery');
INSERT INTO schema_migrations(version) VALUES('010_module_availability_guard')
ON CONFLICT(version) DO NOTHING;
COMMIT;