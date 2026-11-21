-- Platform-wide WhatsApp support contact settings. Additive and safe for existing tenants.
BEGIN;
CREATE TABLE IF NOT EXISTS app_platform_settings (
  setting_key TEXT PRIMARY KEY,
  whatsapp_phone TEXT NOT NULL DEFAULT '595987426497',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  welcome_message TEXT NOT NULL DEFAULT 'Hola, necesito ayuda con Gestión de Negocio.',
  display_name TEXT NOT NULL DEFAULT 'Soporte técnico Gestión de Negocio',
  updated_by UUID REFERENCES app_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO app_platform_settings(setting_key, whatsapp_phone, enabled, welcome_message, display_name)
VALUES ('support', '595987426497', TRUE, 'Hola, necesito ayuda con Gestión de Negocio.', 'Soporte técnico Gestión de Negocio')
ON CONFLICT (setting_key) DO NOTHING;
INSERT INTO schema_migrations(version) VALUES ('005_platform_support_settings')
ON CONFLICT (version) DO NOTHING;
COMMIT;
