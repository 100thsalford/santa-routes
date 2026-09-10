-- Core route/street schema, replacing the Google Sheet as the source of
-- truth for "which streets, on which date, on which route, at what time".
--
-- routes       one row per named route (e.g. "Route 1")
-- route_dates  one row per night a route actually runs
-- streets      one row per street visited during a route_date, in order

CREATE TABLE routes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  display_order INTEGER,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE route_dates (
  id SERIAL PRIMARY KEY,
  route_id INTEGER NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
  event_date DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (route_id, event_date)
);

CREATE INDEX idx_route_dates_event_date ON route_dates(event_date);

CREATE TABLE streets (
  id SERIAL PRIMARY KEY,
  route_date_id INTEGER NOT NULL REFERENCES route_dates(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  name TEXT NOT NULL,
  time_range TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_streets_route_date_id ON streets(route_date_id);
