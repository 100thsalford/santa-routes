// Public search-fallback function: when a visitor's street search finds no
// direct match (they typed a full address, a postcode, or a street we
// genuinely don't cover), this tries to geocode what they typed and finds
// the nearest street we DO cover, so we can say "we don't cover that
// street, but the nearest one we cover is X, coming up on <date>" instead
// of just "no results".
//
// UK postcodes go through postcodes.io (free, precise, no API key).
// Everything else goes through OpenStreetMap's Nominatim, scoped to the
// Salford area. Results are cached in query_geocode_cache so the same
// typo/postcode isn't re-geocoded on every visitor who searches it.

import { getDatabase } from '@netlify/database';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*'
};

const MAX_DISTANCE_MILES = 1;
const SALFORD_VIEWBOX = '-2.38,53.53,-2.20,53.44';
const USER_AGENT = 'SantaSleighSalford/1.0 (https://santasleighsalford.co.uk, matching visitor street searches to our nearest covered street)';

// UK postcode format (full postcode, e.g. "M6 8FA", "SW1A 1AA").
const UK_POSTCODE_RE = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i;

function cleanStreetName(raw) {
  let name = (raw || '').replace(/^\d+[.\-]\s*/, '');
  name = name.replace(/\s*\([^)]*\)/g, '');
  name = name.replace(/\s+/g, ' ').trim();
  return name;
}

function haversineMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8; // Earth's radius in miles
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function geocodeViaPostcodesIo(postcode) {
  try {
    const res = await fetch('https://api.postcodes.io/postcodes/' + encodeURIComponent(postcode.replace(/\s+/g, '')));
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data.result && typeof data.result.latitude === 'number') {
      return { lat: data.result.latitude, lng: data.result.longitude, source: 'postcodes.io' };
    }
  } catch (err) {
    console.error('postcodes.io error:', err);
  }
  return null;
}

async function geocodeViaNominatim(text) {
  try {
    const query = encodeURIComponent(text + ', Salford, Greater Manchester, UK');
    const url = 'https://nominatim.openstreetmap.org/search?q=' + query
      + '&format=json&limit=1&countrycodes=gb&bounded=1&viewbox=' + SALFORD_VIEWBOX;
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) return null;
    const data = await res.json();
    if (data && data[0]) {
      return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), source: 'nominatim' };
    }
  } catch (err) {
    console.error('Nominatim error:', err);
  }
  return null;
}

export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const body = await req.json();
    const rawQuery = (body.query || '').trim();

    if (rawQuery.length < 3) {
      return new Response(JSON.stringify({ geocoded: false, nearestStreet: null }), { status: 200, headers });
    }

    const db = getDatabase();
    const cacheKey = rawQuery.toLowerCase().replace(/\s+/g, ' ');

    // 1. Check the cache first.
    const cacheRows = await db.sql`SELECT found, lat, lng FROM query_geocode_cache WHERE query_text = ${cacheKey}`;

    let point = null;
    if (cacheRows.length > 0) {
      const cached = cacheRows[0];
      if (cached.found) point = { lat: Number(cached.lat), lng: Number(cached.lng) };
    } else {
      // 2. Not cached -- geocode it now. UK postcode-shaped queries go
      // through postcodes.io first; anything else (or a postcode
      // postcodes.io couldn't find) falls through to Nominatim.
      let result = null;
      if (UK_POSTCODE_RE.test(cacheKey)) {
        result = await geocodeViaPostcodesIo(cacheKey);
      }
      if (!result) {
        result = await geocodeViaNominatim(rawQuery);
      }

      if (result) {
        point = { lat: result.lat, lng: result.lng };
      }

      await db.sql`
        INSERT INTO query_geocode_cache (query_text, found, lat, lng, source)
        VALUES (${cacheKey}, ${!!result}, ${result ? result.lat : null}, ${result ? result.lng : null}, ${result ? result.source : null})
        ON CONFLICT (query_text) DO NOTHING
      `;
    }

    if (!point) {
      return new Response(JSON.stringify({ geocoded: false, nearestStreet: null }), { status: 200, headers });
    }

    // 3. Find the nearest street we cover (from upcoming route_dates only).
    const [upcomingRows, geocodeRows] = await Promise.all([
      db.sql`
        SELECT s.name, to_char(rd.event_date, 'YYYY-MM-DD') AS date, r.name AS route_name
        FROM streets s
        JOIN route_dates rd ON rd.id = s.route_date_id
        JOIN routes r ON r.id = rd.route_id
        WHERE rd.event_date >= CURRENT_DATE
      `,
      db.sql`SELECT street_name, lat, lng FROM street_geocodes`
    ]);

    const geocodeMap = new Map();
    for (const row of geocodeRows) {
      geocodeMap.set(row.street_name, { lat: Number(row.lat), lng: Number(row.lng) });
    }

    // Collapse to one entry per physical street (a street can appear more
    // than once in the upcoming window -- multiple time segments on the
    // same night, or repeated across different dates) keeping the
    // soonest upcoming date for each.
    const streetsByKey = new Map();
    for (const row of upcomingRows) {
      const cleaned = cleanStreetName(row.name);
      const key = cleaned.toLowerCase();
      const existing = streetsByKey.get(key);
      if (!existing || row.date < existing.date) {
        streetsByKey.set(key, { street: cleaned, date: row.date, route: row.route_name });
      }
    }

    let nearest = null;
    let nearestDistance = Infinity;

    for (const [key, info] of streetsByKey) {
      const geo = geocodeMap.get(key);
      if (!geo) continue;

      const distance = haversineMiles(point.lat, point.lng, geo.lat, geo.lng);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = { street: info.street, date: info.date, route: info.route, distanceMiles: distance };
      }
    }

    if (!nearest || nearestDistance > MAX_DISTANCE_MILES) {
      return new Response(JSON.stringify({ geocoded: true, nearestStreet: null }), { status: 200, headers });
    }

    return new Response(JSON.stringify({
      geocoded: true,
      nearestStreet: {
        street: nearest.street,
        date: nearest.date,
        route: nearest.route,
        distanceMiles: Math.round(nearest.distanceMiles * 100) / 100
      }
    }), { status: 200, headers });
  } catch (error) {
    console.error('Error finding nearest street:', error);
    return new Response(JSON.stringify({ error: 'Failed to look up nearest street' }), { status: 500, headers });
  }
};
