-- Volunteer self-registration + approval (2026-10-21).
--
-- Two new ways to get a volunteer account, alongside the existing
-- Netlify-dashboard invite:
--   * self-registration on helpout.santasleighsalford.co.uk, gated by a
--     shared sign-up code (settings.signup_code) and landing as
--     approval_status = 'pending' until an admin approves/rejects it;
--   * a branded admin invite (volunteer_invites), whose one-time link
--     registers the person as already 'approved'.
--
-- Both create the Identity user server-side (admin.createUser in
-- helpout-register.js) and insert the volunteers row in the same request,
-- so a pending row always exists before that person can log in. Any row
-- created the old lazy way (first portal visit after a dashboard invite)
-- takes the column default 'approved' -- as do all existing rows -- so
-- nobody already signed up is affected.

ALTER TABLE volunteers
  ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'approved'
    CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS registration_source TEXT,
  ADD COLUMN IF NOT EXISTS registered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

-- Branded admin invites. Only a SHA-256 hash of the token is stored; the
-- raw token exists only in the emailed link.
CREATE TABLE IF NOT EXISTS volunteer_invites (
  id SERIAL PRIMARY KEY,
  token_hash TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  full_name TEXT,
  invited_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  volunteer_id INTEGER REFERENCES volunteers(id) ON DELETE SET NULL
);

-- Per-IP throttle for the public registration endpoint: wrong sign-up
-- codes ('bad_code') and successful registrations ('registered') in the
-- last hour. Rows older than a day are pruned on each insert.
CREATE TABLE IF NOT EXISTS registration_attempts (
  id SERIAL PRIMARY KEY,
  ip TEXT NOT NULL,
  kind TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS registration_attempts_ip_time
  ON registration_attempts (ip, attempted_at);

-- signup_code blank = self-registration closed.
INSERT INTO settings (key, value) VALUES
  ('signup_code', ''),
  ('registration_notify_email', 'nathan.talbot@100thsalford.co.uk')
ON CONFLICT (key) DO NOTHING;
