-- Push notifications for the volunteer portal app (2026-11-21).
--
-- One row per device (browser / installed app) a volunteer has turned
-- notifications on for. endpoint is the push service URL the browser gave
-- us (Apple, Google or Mozilla); p256dh/auth are the keys used to encrypt
-- each message for that device.
--
-- Rows are removed when the volunteer turns notifications off or logs out
-- on that device, when the push service says the subscription has expired
-- (404/410 -- lib/push.js), when the volunteer is deleted (cascade), and by
-- purge-old-logs.js if the portal hasn't been opened on that device for
-- 13 months (last_seen_at is refreshed each time the portal loads).
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id SERIAL PRIMARY KEY,
  volunteer_id INTEGER NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  device_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_success_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS push_subscriptions_volunteer_id_idx ON push_subscriptions (volunteer_id);
