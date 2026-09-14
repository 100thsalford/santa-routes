-- Meeting/gathering time for volunteers (Phase 9 follow-up, 2026-09-13).
-- Free-text like streets.time_range, since a night might read "Gather
-- 5:45pm, walk off at 6pm" rather than a single clean time value.
ALTER TABLE route_dates ADD COLUMN gathering_time TEXT;
