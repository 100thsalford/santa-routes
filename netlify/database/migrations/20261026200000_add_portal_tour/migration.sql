-- Volunteer portal welcome tour (2026-10-26).
--
-- portal_tour_version: the highest version of the volunteer.html welcome
--   tour this volunteer has started or dismissed ("Don't show this again").
--   0 = never seen, so every existing volunteer gets it once on their next
--   login. Bumping TOUR_VERSION in volunteer.html re-shows it to everyone
--   (e.g. after a big new feature).
ALTER TABLE volunteers
  ADD COLUMN IF NOT EXISTS portal_tour_version INTEGER NOT NULL DEFAULT 0;
