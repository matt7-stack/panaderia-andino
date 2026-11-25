CREATE TABLE IF NOT EXISTS app_admin_private_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(160) NOT NULL DEFAULT 'Nota',
  content varchar(4000) NOT NULL,
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_admin_private_notes_updated_idx ON app_admin_private_notes(updated_at DESC);

CREATE TABLE IF NOT EXISTS app_admin_finance_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  entry_type varchar(10) NOT NULL CHECK(entry_type IN ('income','expense')),
  concept varchar(240) NOT NULL,
  amount numeric(14,2) NOT NULL CHECK(amount>0),
  payment_method varchar(60) NOT NULL DEFAULT '',
  notes varchar(500) NOT NULL DEFAULT '',
  created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_admin_finance_entries_date_idx ON app_admin_finance_entries(entry_date DESC,created_at DESC);
