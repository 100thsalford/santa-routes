-- Privacy clean-up (2026-10-23): stop holding identifiers in the log tables.
--
-- log-search.js and log-analytics.js no longer write ip, user_agent,
-- referer, country, city or region. This clears what was already stored,
-- reduces stored search text to what is needed to see which street was
-- wanted, and strips query strings from stored page URLs. The columns
-- themselves are left in place (now always NULL) so a deploy that is still
-- running the previous function code cannot fail on a missing column.

UPDATE search_logs
SET ip = NULL, user_agent = NULL, referer = NULL, country = NULL, city = NULL, region = NULL;

UPDATE analytics_events
SET ip = NULL, user_agent = NULL, referer = NULL;

-- Search text: postcodes -> '[postcode]', emails -> '[removed]', otherwise
-- remove house numbers/digits and cap the length (mirrors log-search.js).
UPDATE search_logs
SET search_term = CASE
  WHEN search_term IS NULL THEN NULL
  WHEN search_term LIKE '%@%' THEN '[removed]'
  WHEN lower(trim(search_term)) ~ '^[a-z]{1,2}[0-9][a-z0-9]? ?[0-9][a-z]{2}$' THEN '[postcode]'
  ELSE COALESCE(
    NULLIF(
      left(trim(regexp_replace(
        regexp_replace(
          regexp_replace(lower(search_term), '\m[a-z]{1,2}[0-9][a-z0-9]? ?[0-9][a-z]{2}\M', ' ', 'g'),
          '\m[0-9]+[a-z]?\M|[0-9]+', ' ', 'g'),
        '\s+', ' ', 'g')), 60),
      ''),
    '[number]')
END;

-- Typed text and full URLs in the free-form event payloads.
UPDATE analytics_events
SET event_data = event_data - 'query' - 'term' - 'search' - 'searchTerm' - 'q'
WHERE event_data ?| array['query', 'term', 'search', 'searchTerm', 'q'];

UPDATE analytics_events
SET event_data = jsonb_set(event_data, '{url}', to_jsonb(split_part(split_part(event_data->>'url', '?', 1), '#', 1)))
WHERE event_data ? 'url' AND jsonb_typeof(event_data->'url') = 'string';
