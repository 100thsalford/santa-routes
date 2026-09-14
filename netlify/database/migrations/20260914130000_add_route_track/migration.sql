-- Interactive route data for volunteer.html's mobile map (2026-09-14).
-- Parsed client-side (admin.html) from a plotaroute.com GPX export
-- (Track type, Directions waypoints) into {points:[[lat,lon],...],
-- directions:[{lat,lon,text,sym,km},...]} and stored as JSONB here.
-- Supplements route_map_key/filename (the static image/PDF a route_date
-- already carries) rather than replacing it -- a date with no route_track
-- yet just falls back to the static map in volunteer.html.
ALTER TABLE route_dates ADD COLUMN route_track JSONB;
