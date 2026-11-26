-- Analytics events and street searches are now buffered in Netlify Blobs
-- and copied into these tables in batches (2026-11-26), so logging them no
-- longer keeps the database awake -- see netlify/lib/analytics-buffer.js.
--
-- buffer_key is the blob key each row was copied from. It is unique so a
-- row is never stored twice if two copies overlap or a blob delete fails
-- after its insert. Older rows (and anything inserted directly) leave it
-- NULL; NULLs don't clash under a unique constraint.
ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS buffer_key TEXT;
ALTER TABLE search_logs ADD COLUMN IF NOT EXISTS buffer_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS analytics_events_buffer_key ON analytics_events (buffer_key);
CREATE UNIQUE INDEX IF NOT EXISTS search_logs_buffer_key ON search_logs (buffer_key);
