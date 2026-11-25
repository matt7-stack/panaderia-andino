-- 026: global platform maintenance mode.
-- Applies only to the platform control plane; business data remains untouched.
BEGIN;

CREATE TABLE IF NOT EXISTS app_platform_maintenance (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  reason TEXT NOT NULL DEFAULT 'maintenance'
    CHECK (reason IN ('maintenance','security','improvements','upgrade','other')),
  message TEXT NOT NULL DEFAULT 'Estamos realizando tareas de mantenimiento. Volveremos pronto.',
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT app_platform_maintenance_valid_window
    CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at),
  CONSTRAINT app_platform_maintenance_message_length
    CHECK (char_length(message) BETWEEN 1 AND 1000)
);

INSERT INTO app_platform_maintenance(id)
VALUES (1)
ON CONFLICT(id) DO NOTHING;

INSERT INTO schema_migrations(version)
VALUES ('026_platform_maintenance_mode')
ON CONFLICT(version) DO NOTHING;

COMMIT;
