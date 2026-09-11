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

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};

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

    const [settingsRows, routeDateRows] = await Promise.all([
      db.sql`SELECT key, value FROM settings`,
      db.sql`SELECT to_char(event_date, 'YYYY-MM-DD') AS date FROM route_dates ORDER BY event_date`
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
        }
      }),
      { status: 200, headers }
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
        }
      }),
      { status: 200, headers }
    );
  }
};
