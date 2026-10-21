-- Special-event flags on route nights (2026-10-21).
--
-- event_flags       admin-managed list of flag types: an emoji + short chip
--                   label (e.g. "⚽ 8pm") with a longer description shown
--                   on tap/hover and in the shift details (e.g. "City Home
--                   8pm"). `style` picks the chip colour: 'neutral',
--                   'amber', 'city' (sky blue) or 'united' (red).
-- route_date_flags  which flags are set on which night (many-to-many, so a
--                   night can be both "Long" and "City Home").
--
-- Volunteer portal + admin only; never shown on the public site.

CREATE TABLE IF NOT EXISTS event_flags (
  id SERIAL PRIMARY KEY,
  emoji TEXT,
  label TEXT NOT NULL,
  description TEXT,
  style TEXT NOT NULL DEFAULT 'neutral'
    CHECK (style IN ('neutral', 'amber', 'city', 'united')),
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS route_date_flags (
  route_date_id INTEGER NOT NULL REFERENCES route_dates(id) ON DELETE CASCADE,
  flag_id INTEGER NOT NULL REFERENCES event_flags(id) ON DELETE CASCADE,
  PRIMARY KEY (route_date_id, flag_id)
);

CREATE INDEX IF NOT EXISTS idx_route_date_flags_flag_id ON route_date_flags(flag_id);

INSERT INTO event_flags (emoji, label, description, style, display_order)
SELECT * FROM (VALUES
  ('⏳', 'Long', 'Can be a long route/late finish', 'amber', 1),
  ('⚽', '8pm', 'City Home 8pm', 'city', 2),
  ('⚽', '8pm', 'City Away 8pm', 'city', 3),
  ('⚽', '8pm', 'United Home 8pm', 'united', 4),
  ('⚽', '8pm', 'United Away 8pm', 'united', 5)
) AS seed(emoji, label, description, style, display_order)
WHERE NOT EXISTS (SELECT 1 FROM event_flags);
