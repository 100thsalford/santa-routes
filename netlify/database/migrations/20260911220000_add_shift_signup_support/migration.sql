-- Support for self-serve volunteer shift signup (Phase 8, step 1).
--
-- volunteer_capacity: target number of volunteers for a route_date, set by
-- an admin. NULL means "not tracking a target" -- no status badge is shown
-- and self-serve claiming is still allowed (an uncapped shift).
--
-- shift_assignments.source: distinguishes an admin-assigned shift from one
-- a volunteer claimed themselves, for display in the admin Volunteer
-- Shifts tab. Doesn't change cancellation rules -- a volunteer can cancel
-- either kind of their own shift, subject to the 24-hour cutoff.

ALTER TABLE route_dates ADD COLUMN volunteer_capacity INTEGER;
ALTER TABLE shift_assignments ADD COLUMN source TEXT NOT NULL DEFAULT 'admin';
