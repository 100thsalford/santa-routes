// Admin-triggered batch geocoder for the "nearest covered street" search
// fallback (see find-nearest-street.js). Geocodes distinct street names
// belonging to upcoming route_dates via OpenStreetMap's Nominatim, storing
// results in street_geocodes so they're reused across seasons/clones.
//
// Processes a small batch per call (rate-limited to Nominatim's 1
// request/second usage policy) and reports how many remain, so the admin
// UI can call this repeatedly in a loop until everything's geocoded
// without any single call running long enough to hit a function timeout.

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';

const headers = { 'Content-Type': 'application/json' };

const BATCH_SIZE = 4;
const NOMINATIM_DELAY_MS = 1100;
// Rough bounding box around Salford / Irlams o' th' Height / Pendlebury
// (left, top, right, bottom -- i.e. minLon,maxLat,maxLon,minLat) to keep
// results local and avoid same-named streets elsewhere matching instead.
const SALFORD_VIEWBOX = '-2.38,53.53,-2.20,53.44';
const USER_AGENT = 'SantaSleighSalford/1.0 (https://santasleighsalford.co.uk, geocoding street list for a volunteer-run Scouts fundraiser)';

function requireAdmin(user) {
  return !!(user && user.roles && user.roles.includes('admin'));
}

// Strips leading sequence numbers and parenthetical notes (e.g.
// "(Partial)", "(Entrance)", "(east of Highfield)") that aren't part of
// the actual street name and would only confuse a geocoder.
function cleanStreetName(raw) {
  let name = (raw || '').replace(/^\d+[.\-]\s*/, '');
  name = name.replace(/\s*\([^)]*\)/g, '');
  name = name.replace(/\s+/g, ' ').trim();
  return name;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default async (req, context) => {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const user = await getUser();
    if (!requireAdmin(user)) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers });
    }

    const db = getDatabase();

    const [streetRows, geocodedRows] = await Promise.all([
      db.sql`
        SELECT DISTINCT s.name
        FROM streets s
        JOIN route_dates rd ON rd.id = s.route_date_id
        WHERE rd.event_date >= CURRENT_DATE
      `,
      db.sql`SELECT street_name FROM street_geocodes`
    ]);

    const alreadyGeocoded = new Set(geocodedRows.map((r) => r.street_name));

    const pendingMap = new Map();
    for (const row of streetRows) {
      const cleaned = cleanStreetName(row.name);
      const key = cleaned.toLowerCase();
      if (!key || alreadyGeocoded.has(key) || pendingMap.has(key)) continue;
      pendingMap.set(key, cleaned);
    }

    const pending = Array.from(pendingMap.entries()); // [[key, cleaned], ...]
    const totalStreets = alreadyGeocoded.size + pending.length;

    // GET is a status-only check -- it never calls out to Nominatim, so
    // the admin tab can show current coverage on load without kicking off
    // any geocoding.
    if (req.method === 'GET') {
      return new Response(JSON.stringify({
        totalStreets,
        alreadyGeocoded: alreadyGeocoded.size,
        remaining: pending.length
      }), { status: 200, headers });
    }

    const batch = pending.slice(0, BATCH_SIZE);

    const geocoded = [];
    const failed = [];

    for (let i = 0; i < batch.length; i++) {
      const [key, cleaned] = batch[i];
      try {
        const query = encodeURIComponent(cleaned + ', Salford, Greater Manchester, UK');
        const url = 'https://nominatim.openstreetmap.org/search?q=' + query
          + '&format=json&limit=1&countrycodes=gb&bounded=1&viewbox=' + SALFORD_VIEWBOX;
        const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });

        if (res.ok) {
          const data = await res.json();
          if (data && data[0]) {
            const lat = parseFloat(data[0].lat);
            const lng = parseFloat(data[0].lon);
            await db.sql`
              INSERT INTO street_geocodes (street_name, lat, lng, source)
              VALUES (${key}, ${lat}, ${lng}, 'nominatim')
              ON CONFLICT (street_name) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, geocoded_at = now()
            `;
            geocoded.push(cleaned);
          } else {
            failed.push(cleaned);
          }
        } else {
          failed.push(cleaned);
        }
      } catch (err) {
        console.error('Geocode error for', cleaned, err);
        failed.push(cleaned);
      }

      if (i < batch.length - 1) {
        await sleep(NOMINATIM_DELAY_MS);
      }
    }

    const remaining = Math.max(pending.length - geocoded.length, 0);

    return new Response(JSON.stringify({
      totalStreets,
      alreadyGeocoded: alreadyGeocoded.size,
      processedThisBatch: batch.length,
      geocoded,
      failed,
      remaining
    }), { status: 200, headers });
  } catch (error) {
    console.error('Error geocoding streets:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
