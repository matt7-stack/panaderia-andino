-- MATTSYSTEM: catálogo de versiones y asignaciones por negocio.
-- Aplicar primero en QA; no ejecutar en producción sin una migración revisada.
CREATE TABLE IF NOT EXISTS app_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version varchar(40) NOT NULL UNIQUE,
  title varchar(160) NOT NULL,
  summary varchar(500) NOT NULL DEFAULT '',
  details text NOT NULL DEFAULT '',
  artifact_url text,
  artifact_sha256 varchar(64),
  artifact_bytes bigint,
  runtime_compatible boolean NOT NULL DEFAULT false,
  status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  delivery_ready boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (artifact_sha256 IS NULL OR artifact_sha256 ~ '^[a-f0-9]{64}$'),
  CHECK (artifact_bytes IS NULL OR artifact_bytes >= 0)
);
ALTER TABLE app_releases ADD COLUMN IF NOT EXISTS runtime_compatible boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS app_business_versions (
  business_id uuid PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  installed_release_id uuid REFERENCES app_releases(id) ON DELETE RESTRICT,
  target_release_id uuid REFERENCES app_releases(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES app_users(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS app_version_upgrade_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  from_release_id uuid REFERENCES app_releases(id) ON DELETE RESTRICT,
  to_release_id uuid NOT NULL REFERENCES app_releases(id) ON DELETE RESTRICT,
  quoted_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (quoted_amount >= 0),
  client_accepted_at timestamptz,
  paid_at timestamptz,
  payment_reference varchar(160),
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','paid','approved','applied','rejected','cancelled')),
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  approved_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz
);
CREATE INDEX IF NOT EXISTS app_version_upgrade_requests_business_idx ON app_version_upgrade_requests(business_id,created_at DESC);
CREATE INDEX IF NOT EXISTS app_releases_status_published_idx ON app_releases(status,published_at DESC);
INSERT INTO app_releases(version,title,summary,details,artifact_url,artifact_sha256,artifact_bytes,runtime_compatible,status,delivery_ready,published_at)
VALUES('2.0.1','MATTSYSTEM 2.0.1','Versión base registrada para distribución por negocio.','Snapshot inmutable de la versión 2.0.1 con bootstrap de verificación SHA-256.','/releases/2.0.1/app.bundle.html','c333d7607951c3067c33378338d4f3b22319add328118f641f327221007c8505',592235,true,'published',true,now())
ON CONFLICT(version) DO NOTHING;
INSERT INTO app_business_versions(business_id,installed_release_id,target_release_id)
SELECT b.id,r.id,r.id FROM businesses b CROSS JOIN app_releases r WHERE r.version='2.0.1'
ON CONFLICT(business_id) DO NOTHING;

ALTER TABLE app_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_releases FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mattsystem_releases_admin_all ON app_releases;
CREATE POLICY mattsystem_releases_admin_all ON app_releases FOR ALL USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());
ALTER TABLE app_business_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_business_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mattsystem_business_versions_admin_all ON app_business_versions;
CREATE POLICY mattsystem_business_versions_admin_all ON app_business_versions FOR ALL USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());
ALTER TABLE app_version_upgrade_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_version_upgrade_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mattsystem_version_upgrades_admin_all ON app_version_upgrade_requests;
CREATE POLICY mattsystem_version_upgrades_admin_all ON app_version_upgrade_requests FOR ALL USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());

CREATE TABLE IF NOT EXISTS app_business_version_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  from_release_id uuid REFERENCES app_releases(id) ON DELETE SET NULL,
  to_release_id uuid NOT NULL REFERENCES app_releases(id) ON DELETE RESTRICT,
  change_reason varchar(30) NOT NULL DEFAULT 'upgrade' CHECK (change_reason IN ('initial','upgrade','rollback','runtime_acknowledged')),
  changed_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_business_version_history_business_idx ON app_business_version_history(business_id,changed_at DESC);
ALTER TABLE app_business_version_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_business_version_history FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS mattsystem_business_version_history_admin_all ON app_business_version_history;
CREATE POLICY mattsystem_business_version_history_admin_all ON app_business_version_history FOR ALL USING (app_is_platform_admin()) WITH CHECK (app_is_platform_admin());
DROP POLICY IF EXISTS mattsystem_business_version_history_tenant_read ON app_business_version_history;
CREATE POLICY mattsystem_business_version_history_tenant_read ON app_business_version_history FOR SELECT USING (business_id=app_current_business_id());
DROP POLICY IF EXISTS mattsystem_business_version_history_tenant_insert ON app_business_version_history;
CREATE POLICY mattsystem_business_version_history_tenant_insert ON app_business_version_history FOR INSERT WITH CHECK (business_id=app_current_business_id());
DROP POLICY IF EXISTS mattsystem_business_versions_tenant_read ON app_business_versions;
CREATE POLICY mattsystem_business_versions_tenant_read ON app_business_versions FOR SELECT USING (business_id=app_current_business_id());
DROP POLICY IF EXISTS mattsystem_business_versions_tenant_ack ON app_business_versions;
CREATE POLICY mattsystem_business_versions_tenant_ack ON app_business_versions FOR UPDATE USING (business_id=app_current_business_id()) WITH CHECK (business_id=app_current_business_id());

DROP POLICY IF EXISTS mattsystem_releases_published_read ON app_releases;
CREATE POLICY mattsystem_releases_published_read ON app_releases FOR SELECT USING (status='published');

DROP POLICY IF EXISTS mattsystem_version_upgrades_tenant_ack ON app_version_upgrade_requests;
CREATE POLICY mattsystem_version_upgrades_tenant_ack ON app_version_upgrade_requests FOR UPDATE USING (business_id=app_current_business_id()) WITH CHECK (business_id=app_current_business_id());

ALTER TABLE app_releases ADD COLUMN IF NOT EXISTS artifact_content text;
