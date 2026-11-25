-- MATTSYSTEM: novedades y versiones publicadas por el administrador
CREATE TABLE IF NOT EXISTS app_release_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(140) NOT NULL,
  version varchar(40) NOT NULL DEFAULT '',
  category varchar(40) NOT NULL DEFAULT 'mejora',
  summary varchar(500) NOT NULL DEFAULT '',
  content text NOT NULL,
  published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_release_notes_published_idx
  ON app_release_notes(published, published_at DESC, created_at DESC);
