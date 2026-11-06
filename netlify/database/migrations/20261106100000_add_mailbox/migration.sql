-- hello@ mailbox in the volunteer portal (2026-11-06).
--
-- The mail itself lives in Resend Inboxes (threads, folders, attachments);
-- the portal is a thin client over it (netlify/functions/mailbox.js).
--
-- volunteers.mailbox_access: an admin has let this volunteer use the
--   Mailbox. Checked server-side on every mailbox call, so turning it off
--   takes effect straight away.
-- volunteers.mailbox_alerts: email them when new mail arrives (at most
--   one alert every 30 minutes -- mailbox-alerts.js). They can turn it off
--   from the Mailbox page.
-- mailbox_sent_log: which volunteer sent each email from the shared
--   address, since the inbox itself can't tell people apart. Deleted after
--   13 months by purge-old-logs.js.
ALTER TABLE volunteers
  ADD COLUMN IF NOT EXISTS mailbox_access BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mailbox_alerts BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS mailbox_sent_log (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  volunteer_id INTEGER REFERENCES volunteers(id) ON DELETE SET NULL,
  sender_name TEXT,
  action TEXT NOT NULL,
  thread_id TEXT,
  email_id TEXT,
  subject TEXT,
  recipient_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS mailbox_sent_log_email_id_idx ON mailbox_sent_log (email_id);
CREATE INDEX IF NOT EXISTS mailbox_sent_log_thread_id_idx ON mailbox_sent_log (thread_id);
CREATE INDEX IF NOT EXISTS mailbox_sent_log_created_at_idx ON mailbox_sent_log (created_at);
