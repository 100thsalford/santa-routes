-- Street search logs from index.html's "When is Santa visiting?" search box.
-- Replaces the old Google Sheets webhook (log-search.js used to POST to
-- GOOGLE_SHEETS_WEBHOOK_URL) with a permanent home in the same DB as
-- everything else -- the Sheets webhook and its 24-hour-only Netlify log
-- fallback meant search history wasn't reliably kept anywhere.
CREATE TABLE search_logs (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  search_term TEXT,
  match_found BOOLEAN NOT NULL DEFAULT FALSE,
  matched_street TEXT,
  results_count INTEGER NOT NULL DEFAULT 0,
  page TEXT,
  user_agent TEXT,
  referer TEXT,
  ip TEXT,
  country TEXT,
  city TEXT,
  region TEXT
);

CREATE INDEX idx_search_logs_created_at ON search_logs (created_at DESC);
