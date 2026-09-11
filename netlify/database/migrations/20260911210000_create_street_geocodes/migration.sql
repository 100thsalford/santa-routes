-- Caches geocoded coordinates for street names, keyed by a normalized
-- (lowercased, whitespace-collapsed) version of the name. Independent of
-- route_dates/streets rows so a street's location is only ever geocoded
-- once and is reused across seasons, even though `streets` rows themselves
-- are per route_date (see the "clone into new date" admin feature).
CREATE TABLE street_geocodes (
  id SERIAL PRIMARY KEY,
  street_name TEXT NOT NULL UNIQUE,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  source TEXT NOT NULL DEFAULT 'nominatim',
  geocoded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
