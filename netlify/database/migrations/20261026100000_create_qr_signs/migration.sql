-- QR street-sign register (2026-10-26).
--
-- qr_signs: the fixed, printed sign numbers. Each sticker's QR encodes
-- https://santasleighsalford.co.uk/s/<sign_id>, so these IDs never change
-- and are reused every season. Seeded with 001-045 (the 2026 print run).
--
-- qr_sign_placements: where a sign is placed in a given season (season =
-- 1 Aug to 31 Jul, named by its starting year), so a sticker can move in a
-- later year without rewriting what earlier seasons meant. Admin-only.
-- location_label is a street or landmark, never a host's name or address;
-- host contact details stay in Microsoft Forms/Excel.
--
-- Visits themselves are NOT stored here: they are ordinary
-- analytics_events rows (event_type 'qr_sign_visit', event_data
-- {"sign_id": "023"}), sent only when the visitor's analytics preference
-- allows it and purged after 13 months with every other event.
CREATE TABLE IF NOT EXISTS qr_signs (
  sign_id TEXT PRIMARY KEY CHECK (sign_id ~ '^[0-9]{3}$' AND sign_id <> '000'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO qr_signs (sign_id)
SELECT lpad(g::text, 3, '0') FROM generate_series(1, 45) AS g
ON CONFLICT (sign_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS qr_sign_placements (
  id SERIAL PRIMARY KEY,
  sign_id TEXT NOT NULL REFERENCES qr_signs (sign_id) ON DELETE CASCADE,
  season INTEGER NOT NULL CHECK (season BETWEEN 2020 AND 2100),
  location_label TEXT,
  status TEXT NOT NULL DEFAULT 'not_installed'
    CHECK (status IN ('not_installed', 'installed', 'removed')),
  installed_date DATE,
  removed_date DATE,
  notes TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sign_id, season)
);

-- Per-sign reporting over analytics_events.
CREATE INDEX IF NOT EXISTS analytics_events_qr_sign
  ON analytics_events ((event_data->>'sign_id'), created_at)
  WHERE event_type = 'qr_sign_visit';
