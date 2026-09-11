-- Event-detail fields for route_dates (Phase 8, step 2): a what3words
-- meeting point, free-text notes for volunteers, and the route map file.
-- The file itself lives in Netlify Blobs (store 'route-maps'), not the DB --
-- route_map_key is just the blob store key, filename/content_type are kept
-- alongside it so the UI can show/serve it without a second round trip.

ALTER TABLE route_dates ADD COLUMN what3words TEXT;
ALTER TABLE route_dates ADD COLUMN notes TEXT;
ALTER TABLE route_dates ADD COLUMN route_map_key TEXT;
ALTER TABLE route_dates ADD COLUMN route_map_filename TEXT;
ALTER TABLE route_dates ADD COLUMN route_map_content_type TEXT;
