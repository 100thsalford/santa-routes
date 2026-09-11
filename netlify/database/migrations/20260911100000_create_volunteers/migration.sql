-- Volunteer accounts (step 3). One row per Netlify Identity user, created
-- lazily the first time a logged-in volunteer's profile is fetched.
--
-- Shift/route assignment is NOT part of this table yet -- that arrives with
-- the admin route/street/date management screens (step 4). For now this
-- just backs the account itself and the volunteer's own reminder email
-- preference.

CREATE TABLE volunteers (
  id SERIAL PRIMARY KEY,
  identity_user_id TEXT UNIQUE NOT NULL,
  email TEXT NOT NULL,
  reminder_email_opt_in BOOLEAN NOT NULL DEFAULT TRUE,
  preferred_email TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
