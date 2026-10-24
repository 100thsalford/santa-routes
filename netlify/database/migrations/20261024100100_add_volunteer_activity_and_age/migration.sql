-- Volunteer retention + adult confirmation (2026-10-24).
--
-- last_active_at: refreshed when a volunteer opens the portal. Together with
--   the dates of the nights they were booked on (shift_assignments /
--   event_role_assignments) and created_at, it decides who has had no login
--   or volunteering activity for 3 years. Such volunteers are FLAGGED to
--   admins for manual review and deletion -- nothing is deleted
--   automatically. Existing rows start from updated_at so nobody is
--   wrongly flagged.
-- adult_confirmed_at: when the volunteer (or, for a guest with no login,
--   the admin adding them) confirmed they are 18 or over.
ALTER TABLE volunteers
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS adult_confirmed_at TIMESTAMPTZ;

UPDATE volunteers SET last_active_at = updated_at WHERE last_active_at IS NULL;
