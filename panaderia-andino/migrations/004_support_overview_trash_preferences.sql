-- 004_support_overview_trash_preferences.sql
-- Mattsystem preview: support tickets, activity timestamps, notification preferences and recoverable trash.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS last_seen_at timestamptz;
CREATE TABLE IF NOT EXISTS app_support_tickets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 business_id uuid NOT NULL REFERENCES businesses(id) ON DELETE RESTRICT,
 created_by uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
 subject text NOT NULL,
 message text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved','closed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_support_tickets_business_idx ON app_support_tickets(business_id,created_at DESC);
CREATE INDEX IF NOT EXISTS app_support_tickets_status_idx ON app_support_tickets(status,updated_at DESC);
CREATE TABLE IF NOT EXISTS app_support_replies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 ticket_id uuid NOT NULL REFERENCES app_support_tickets(id) ON DELETE CASCADE,
 author_user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
 message text NOT NULL,
 is_admin boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_support_replies_ticket_idx ON app_support_replies(ticket_id,created_at);
CREATE TABLE IF NOT EXISTS app_notification_preferences (
 user_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
 preferences jsonb NOT NULL DEFAULT '{"system":true,"financial":true,"support":true}'::jsonb,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS app_trash (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 entity_type text NOT NULL CHECK(entity_type IN ('business','user','announcement')),
 entity_id text NOT NULL,
 business_id uuid NULL,
 payload jsonb NOT NULL,
 deleted_by uuid NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
 deleted_at timestamptz NOT NULL DEFAULT now(),
 restored_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS app_trash_deleted_idx ON app_trash(deleted_at DESC) WHERE restored_at IS NULL;
