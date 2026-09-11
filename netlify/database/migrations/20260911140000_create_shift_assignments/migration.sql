-- Volunteer -> shift assignment (step 4). A volunteer can be assigned to a
-- route_date (one route's run on one day); a route_date can have multiple
-- volunteers (e.g. driver + collector).

CREATE TABLE shift_assignments (
  id SERIAL PRIMARY KEY,
  route_date_id INTEGER NOT NULL REFERENCES route_dates(id) ON DELETE CASCADE,
  volunteer_id INTEGER NOT NULL REFERENCES volunteers(id) ON DELETE CASCADE,
  role TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(route_date_id, volunteer_id)
);
