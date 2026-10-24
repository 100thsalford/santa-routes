-- Santa sighting reports (2026-10-24), moved off the old Google Form/Sheet
-- onto the Netlify DB so the 30-day retention in the privacy policy can be
-- enforced automatically (purge-old-logs.js).
--
-- Holds only what the public feature needs: the street (picked from the
-- route list), the time the visitor says they saw the sleigh, whether that
-- was "Just Now" or "Earlier Today", and when the report was submitted.
-- No IP address, user agent or any other identifier is stored.
CREATE TABLE IF NOT EXISTS sightings (
  id SERIAL PRIMARY KEY,
  street TEXT NOT NULL,
  seen_time TEXT NOT NULL,
  seen_when TEXT NOT NULL DEFAULT 'Just Now',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS sightings_created_at ON sightings (created_at);

-- The purge deletes by date on these tables every night.
CREATE INDEX IF NOT EXISTS search_logs_created_at ON search_logs (created_at);
CREATE INDEX IF NOT EXISTS analytics_events_created_at ON analytics_events (created_at);
CREATE INDEX IF NOT EXISTS registration_attempts_time ON registration_attempts (attempted_at);
