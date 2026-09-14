-- Phase 9: per-volunteer role qualification (Santa/Safety Walker/Driver)
-- and a denormalized display name, plus a dedicated table for the
-- per-event Santa/Safety Walker/Driver role assignments shown on the
-- admin dashboard -- kept separate from shift_assignments because these
-- role slots are not part of the general volunteer-capacity count (an
-- event can show "0/8 volunteers" while still having a Santa assigned).

ALTER TABLE volunteers
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS can_be_santa BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_be_safety_walker BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_be_driver BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS event_role_assignments (
  id SERIAL PRIMARY KEY,
  route_date_id INTEGER NOT NULL REFERENCES route_dates(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('santa', 'safety_walker', 'driver')),
  volunteer_id INTEGER REFERENCES volunteers(id) ON DELETE SET NULL,
  UNIQUE(route_date_id, role)
);
