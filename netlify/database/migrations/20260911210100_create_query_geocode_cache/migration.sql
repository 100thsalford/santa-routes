-- Caches geocoding results for visitor search queries (postcodes and free-
-- text addresses that didn't match a street name directly), so the same
-- typo/postcode isn't sent to the external geocoder (postcodes.io /
-- Nominatim) more than once. Caches misses too (found = false) so repeated
-- ungeocodable queries don't keep hitting the external API either.
CREATE TABLE query_geocode_cache (
  id SERIAL PRIMARY KEY,
  query_text TEXT NOT NULL UNIQUE,
  found BOOLEAN NOT NULL DEFAULT FALSE,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  source TEXT,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_query_geocode_cache_cached_at ON query_geocode_cache (cached_at);
