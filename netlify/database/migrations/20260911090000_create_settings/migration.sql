-- Settings table: small admin-editable config values that used to be
-- hardcoded date/time constants scattered across index.html and script.js.
--
-- season_lead_days / season_trail_days control how many days before the
-- first route date and after the last route date the live-tracking nav
-- is shown, relative to the route dates already stored in route_dates.
-- sightings_window_start / sightings_window_end control the time-of-day
-- window (Europe/London) during which sightings/reporting are active on
-- an actual route day.

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO settings (key, value) VALUES
  ('season_lead_days', '7'),
  ('season_trail_days', '1'),
  ('sightings_window_start', '17:00'),
  ('sightings_window_end', '22:00')
ON CONFLICT (key) DO NOTHING;
