// Netlify Function (v2, fetch-style) that computes the site's current
// "is the season live / are sightings active right now" status from the
// database. This is the single source of truth that replaces the old
// scattered hardcoded date/time checks in index.html and script.js.
//
// On non-production deploys (branch deploys, deploy previews, local dev),
// an ?asOf=<ISO datetime> query param overrides "now" for testing
// date/time-gated features without waiting for the real calendar. This is
// ignored in production so real visitors can never see a faked date.

import { getDatabase } from '@netlify/database';
import { cdnCacheHeaders, CACHE_TAGS } from '../lib/cdn-cache.js';
import { trackingWindow } from '../lib/tracking-window.js';
import { cacheSecondsFor } from '../lib/site-status-cache.js';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};

// Polled every 60s by every open page that loads script.js, plus once per
// index.html load -- so the CDN answers repeats. The database sleeps after
// 5 minutes without a query (and is billed while awake), so a short cache
// here kept it awake whenever anyone had the site open. Instead the CDN
// keeps each answer until the next moment it could change on its own --
// midnight, or today's sightings/tracking window start or end, or an
// admin override expiring -- capped at 15 minutes (lib/site-status-cache.js). So boundaries
// like the 10pm cutoff still show on time (at worst one poll late, via
// stale-while-revalidate), and admin changes to settings or route dates
// purge it straight away (see lib/cdn-cache.js). asOf stays in the cache
// key so staging's date-override testing still works.
function cacheHeadersFor(maxAge) {
  return cdnCacheHeaders({
    maxAge,
    staleWhileRevalidate: 60,
    tags: [CACHE_TAGS.siteStatus],
    vary: 'query=asOf'
  });
}

const TIME_ZONE = 'Europe/London';

function londonDateString(date) {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function londonTimeString(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(date);
}

function addDays(dateString, days) {
  const d = new Date(dateString + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers });
  }

  try {
    const db = getDatabase();
    const url = new URL(req.url);
    const asOfParam = url.searchParams.get('asOf');

    // Only non-production deploys honour the test override.
    const allowOverride = process.env.CONTEXT !== 'production';
    let now = new Date();
    let overrideApplied = false;
    if (allowOverride && asOfParam) {
      const parsed = new Date(asOfParam);
      if (!isNaN(parsed.getTime())) {
        now = parsed;
        overrideApplied = true;
      }
    }

    const todayDate = londonDateString(now);
    const nowTime = londonTimeString(now);

    const [settingsRows, routeDateRows, totalRaisedRows] = await Promise.all([
      db.sql`SELECT key, value FROM settings`,
      db.sql`SELECT to_char(event_date, 'YYYY-MM-DD') AS date, tracking_end_time FROM route_dates ORDER BY event_date`,
      // "Total Raised" always reflects the most recent season that has any
      // dates entered -- so it shows last year's final total right up
      // until this year's dates are added, then switches over to this
      // year's (initially zero, then growing as nights are recorded).
      db.sql`
        SELECT COALESCE(SUM(amount_collected), 0) AS total, MAX(EXTRACT(YEAR FROM event_date)) AS year
        FROM route_dates
        WHERE EXTRACT(YEAR FROM event_date) = (SELECT MAX(EXTRACT(YEAR FROM event_date)) FROM route_dates)
      `
    ]);

    const settings = {};
    for (const row of settingsRows) settings[row.key] = row.value;

    const leadDays = parseInt(settings.season_lead_days || '7', 10);
    const trailDays = parseInt(settings.season_trail_days || '1', 10);
    const windowStart = settings.sightings_window_start || '17:00';
    const windowEnd = settings.sightings_window_end || '22:00';

    const routeDates = routeDateRows.map((r) => r.date);
    const firstRouteDate = routeDates[0] || null;
    const lastRouteDate = routeDates[routeDates.length - 1] || null;

    const season = { start: null, end: null, active: false };
    if (firstRouteDate && lastRouteDate) {
      season.start = addDays(firstRouteDate, -leadDays);
      season.end = addDays(lastRouteDate, trailDays);
      season.active = todayDate >= season.start && todayDate < season.end;
    }

    const nextRouteDate = routeDates.find((d) => d > todayDate) || null;
    const isRouteDay = routeDates.includes(todayDate);

    let sightingsState = 'off-season';
    let sightingsActive = false;

    if (season.active) {
      if (isRouteDay) {
        if (nowTime < windowStart) {
          sightingsState = 'before-window';
        } else if (nowTime >= windowEnd) {
          sightingsState = nextRouteDate ? 'after-window' : 'season-ending';
        } else {
          sightingsState = 'active';
          sightingsActive = true;
        }
      } else {
        sightingsState = 'not-a-route-day';
      }
    }

    const todayRoute = routeDateRows.find((r) => r.date === todayDate) || null;
    // Public view only: an admin-preview "On" override never shows here.
    const tracking = trackingWindow(settings, todayRoute, now);

    const cacheSeconds = cacheSecondsFor(
      now,
      [windowStart, windowEnd, tracking.start, tracking.end],
      [settings.tracking_override_until ? Date.parse(settings.tracking_override_until) : NaN]
    );

    const totalRaisedRow = totalRaisedRows[0];
    const totalRaised = totalRaisedRow ? Number(totalRaisedRow.total) : 0;
    const totalRaisedYear = totalRaisedRow && totalRaisedRow.year != null ? Number(totalRaisedRow.year) : null;

    return new Response(
      JSON.stringify({
        now: now.toISOString(),
        todayDate,
        overrideApplied,
        season,
        sightings: {
          active: sightingsActive,
          state: sightingsState,
          windowStart,
          windowEnd,
          nextRouteDate
        },
        tracking: {
          active: tracking.active,
          state: tracking.state,
          windowStart: tracking.start,
          windowEnd: tracking.end,
          forced: tracking.forced
        },
        totalRaised,
        totalRaisedYear
      }),
      { status: 200, headers: { ...headers, ...cacheHeadersFor(cacheSeconds) } }
    );
  } catch (error) {
    console.error('Error computing site status:', error);
    // Fail safe: treat as off-season / inactive rather than risk showing
    // live features (or a broken sightings feed) on an error.
    return new Response(
      JSON.stringify({
        error: error.message,
        season: { start: null, end: null, active: false },
        sightings: {
          active: false,
          state: 'error',
          windowStart: null,
          windowEnd: null,
          nextRouteDate: null
        },
        tracking: { active: false, state: 'error', windowStart: null, windowEnd: null }
      }),
      // Never cache the fail-safe answer -- the next call should retry.
      { status: 200, headers: { ...headers, 'Cache-Control': 'no-store' } }
    );
  }
};
