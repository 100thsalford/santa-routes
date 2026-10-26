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
//
// QR street-sign visits (event 'qr_sign_visit', sent by qr.html) are held to
// a fixed shape: the sign number must exist in the qr_signs register, and
// only {sign_id} (plus a test flag for admin devices) is ever stored.

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

const QR_EVENT = 'qr_sign_visit';

// Returns the stored eventData for a QR visit, or null if it isn't valid.
async function cleanQrVisit(db, raw) {
  const signId = raw && typeof raw.sign_id === 'string' ? raw.sign_id : '';
  if (!/^\d{3}$/.test(signId)) return null;
  const rows = await db.sql`SELECT 1 FROM qr_signs WHERE sign_id = ${signId}`;
  if (!rows.length) return null;
  const out = { sign_id: signId };
  if (raw.test === true) out.test = true;
  return out;
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const data = await req.json();
    const db = getDatabase();

    const eventType = String(data.eventType || 'unknown').slice(0, 60);
    let eventData;
    let page;
    if (eventType === QR_EVENT) {
      eventData = await cleanQrVisit(db, data.eventData);
      if (!eventData) {
        return new Response(JSON.stringify({ error: 'Unknown sign' }), { status: 400, headers });
      }
      page = '/s/' + eventData.sign_id;
    } else {
      eventData = cleanEventData(data.eventData);
      page = pathOnly(data.page || 'Unknown');
    }

    await db.sql`
      INSERT INTO analytics_events (event_type, event_data, page)
      VALUES (${eventType}, ${JSON.stringify(eventData)}::jsonb, ${page})
    `;

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (error) {
    console.error('Analytics error:', error);
    return new Response(JSON.stringify({ error: 'Failed to log event' }), { status: 500, headers });
  }
};
