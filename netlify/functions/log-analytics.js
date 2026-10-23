// Logs an anonymous site analytics event (page views, tab switches, donation
// clicks, sighting reports, time-on-page pings, etc.) from analytics.js into
// the analytics_events table.
//
// Privacy by design: no IP address, user agent or referrer is stored, no
// cookie or visitor ID is used, and typed search text is never kept here
// (street searches are logged, minimised, by log-search.js). Page URLs are
// reduced to their path. Rows are deleted after 13 months by
// purge-old-logs.js. The ip/user_agent/referer columns remain in the table
// only so older deploys keep working; they are always written as NULL.
// Fire-and-forget from the client, so failures here should never surface
// to the visitor.

import { getDatabase } from '@netlify/database';

const headers = { 'Content-Type': 'application/json' };

const DROP_KEYS = ['query', 'term', 'search', 'searchTerm', 'q'];

function pathOnly(value) {
  const s = String(value || '');
  try {
    return new URL(s, 'https://example.invalid').pathname.slice(0, 100);
  } catch (e) {
    return s.split('?')[0].split('#')[0].slice(0, 100);
  }
}

// Shallow clean of the free-form event payload: drop any typed-text fields,
// reduce URLs to paths, and cap string lengths.
function cleanEventData(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  Object.keys(raw).slice(0, 20).forEach(function (key) {
    if (DROP_KEYS.indexOf(key) !== -1) return;
    let v = raw[key];
    if (typeof v === 'string') {
      v = /url|href|link/i.test(key) ? pathOnly(v) : v.slice(0, 200);
    } else if (typeof v === 'object') {
      return; // payloads here are flat; nothing nested is expected
    }
    out[key] = v;
  });
  return out;
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const data = await req.json();
    const db = getDatabase();

    await db.sql`
      INSERT INTO analytics_events (event_type, event_data, page)
      VALUES (
        ${String(data.eventType || 'unknown').slice(0, 60)},
        ${JSON.stringify(cleanEventData(data.eventData))}::jsonb,
        ${pathOnly(data.page || 'Unknown')}
      )
    `;

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (error) {
    console.error('Analytics error:', error);
    return new Response(JSON.stringify({ error: 'Failed to log event' }), { status: 500, headers });
  }
};
