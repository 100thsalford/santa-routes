-- Volunteer-only "internal" name for a route (2026-10-16), e.g. Route 3
-- -> "Weaste & Seedley". Shown alongside the public name in the volunteer
-- portal, reminder emails and admin; never returned by the public
-- functions (get-routes, find-nearest-street, get-public-routes,
-- get-tracking-data).
ALTER TABLE routes ADD COLUMN internal_name TEXT;
