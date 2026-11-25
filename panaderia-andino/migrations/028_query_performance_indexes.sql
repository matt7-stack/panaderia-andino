-- Add indexes for common tenant-scoped history and active-trash lookups.
-- Additive only: no records are changed or removed.
BEGIN;
CREATE INDEX IF NOT EXISTS app_backup_log_business_created_idx ON app_backup_log(business_id,created_at DESC);
CREATE INDEX IF NOT EXISTS app_notifications_business_created_idx ON app_notifications(business_id,created_at DESC);
CREATE INDEX IF NOT EXISTS app_production_batches_business_status_created_idx ON app_production_batches(business_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS app_quotations_business_created_idx ON app_quotations(business_id,created_at DESC);
CREATE INDEX IF NOT EXISTS app_trash_business_active_idx ON app_trash(business_id,deleted_at DESC) WHERE restored_at IS NULL;
CREATE INDEX IF NOT EXISTS app_trash_entity_active_idx ON app_trash(entity_type,entity_id) WHERE restored_at IS NULL;
INSERT INTO schema_migrations(version) VALUES('028_query_performance_indexes') ON CONFLICT(version) DO NOTHING;
COMMIT;
