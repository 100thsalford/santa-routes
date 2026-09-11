-- General site analytics events (page views, tab switches, donation/report
-- clicks, time-on-page pings, etc.) from analytics.js. Same rationale as
-- search_logs: replaces the Google Sheets webhook (GOOGLE_SHEETS_ANALYTICS_WEBHOOK_URL)
-- with a permanent home in this DB. event_data is a free-form JSON blob
-- since the shape varies a lot by event type.
CREATE TABLE analytics_events (
  id SERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  event_type TEXT NOT NULL,
  event_data JSONB,
  page TEXT,
  user_agent TEXT,
  referer TEXT,
  ip TEXT
);

CREATE INDEX idx_analytics_events_created_at ON analytics_events (created_at DESC);
CREATE INDEX idx_analytics_events_event_type ON analytics_events (event_type);
