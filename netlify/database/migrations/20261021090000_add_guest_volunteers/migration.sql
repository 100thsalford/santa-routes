-- Guest volunteers (2026-10-21): some helpers don't want or need a
-- Netlify Identity login (a one-off doorstep helper, a second adult just
-- tagging along, etc.) but still need to be assignable to shifts and to
-- the Santa/Safety-Walker/Driver role slots, same as a logged-in
-- volunteer. identity_user_id and email were both NOT NULL, which made
-- that impossible -- every row in `volunteers` had to be a real account.
--
-- Guest rows (is_guest = true) now sit in the same table with no
-- identity_user_id at all, added by an admin via a quick "Add volunteer"
-- action (name required, phone/email optional, for the admin's own
-- reference -- not wired into the automated email reminders, since
-- guests have no login to send them to). Every existing join against
-- volunteers.id (shift_assignments, event_role_assignments) already
-- works unchanged for these rows.
ALTER TABLE volunteers
  ALTER COLUMN identity_user_id DROP NOT NULL,
  ALTER COLUMN email DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS phone TEXT;
