-- Optional per-night live-tracking cut-off (2026-10-16), "HH:MM" 24hr.
-- NULL = use the season default (settings.tracking_window_end). Lets a
-- route that finishes early stop sharing the sleigh's position sooner,
-- since the TruTrak unit can keep transmitting after it's switched off.
ALTER TABLE route_dates ADD COLUMN tracking_end_time TEXT;
