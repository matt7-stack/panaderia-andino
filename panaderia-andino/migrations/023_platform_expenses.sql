CREATE TABLE IF NOT EXISTS app_platform_expenses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 expense_date date NOT NULL DEFAULT CURRENT_DATE,
 category varchar(80) NOT NULL,
 description varchar(240) NOT NULL,
 amount numeric(14,2) NOT NULL CHECK(amount>0),
 recurrence varchar(20) NOT NULL DEFAULT 'one_time' CHECK(recurrence IN ('one_time','monthly','annual')),
 notes varchar(500) NOT NULL DEFAULT '',
 created_by uuid REFERENCES app_users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_platform_expenses_date_idx ON app_platform_expenses(expense_date DESC);
