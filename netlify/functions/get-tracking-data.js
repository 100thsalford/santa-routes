// Public endpoint powering track.html's live sleigh map -- replaces the
// old Glympse-based "Track Santa Live" button. Determines whether tonight
// is a route night and whether we're inside the live window (reusing
// settings.sightings_window_start/end, the same window get-site-status.js
// uses for the sightings feature), and -- only while that window is open
// -- fetches the sleigh's current GPS position from TruTrak (the FMT200
// device fitted to the sleigh).
//
// Credentials (TRUTRAK_LOGIN/PASSWORD/SKEY) never leave this function --
// the browser only ever sees the parsed position JSON below. TruTrak's
// ASMX web service accepts a plain HTTP POST (not a full SOAP envelope)
// and returns bare XML -- see TruTrak API V1.0.1 docs. Auth tokens (24h
// validity) and the resolved Asset_ID are cached in Netlify Blobs so a
// burst of simultaneous visitors doesn't multiply TruTrak API calls or
// re-authenticate on every request; the last known position is also
// cached briefly for the same reason (see LOCATION_CACHE_TTL_MS).
//
// Which physical asset is "the sleigh" is an admin setting
// (settings.trutrak_asset_registration, e.g. "PZ54 GDX") rather than a
// hardcoded env var -- see admin-trutrak-assets.js for the admin-side
// lookup helper, and admin-settings.js for where it's saved.

import { getDatabase } from '@netlify/database';
import { getStore } from '@netlify/blobs';
import { parseStringPromise } from 'xml2js';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};

const TIME_ZONE = 'Europe/London';
const TT_BASE = 'https://ttapi.trutrakpro.co.uk/WSDataProvider.asmx';
const LOCATION_CACHE_TTL_MS = 60000; // TruTrak's own stated limit is 1 call every 30s minimum, "preferably" 1/min -- we default to their preferred cadence rather than the bare minimum
const POSITION_STALE_MS = 10 * 60 * 1000; // if a fresh TruTrak read fails or comes back empty (e.g. the sleigh is parked/stationary between GPS pings), keep showing the last known position for up to 10 minutes rather than flipping straight to "no signal"

function londonDateString(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

function londonTimeString(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(date);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

function field(row, name, fallback = null) {
  return row[name] && row[name][0] !== undefined ? row[name][0] : fallback;
}

async function ttRequest(method, params) {
  const body = new URLSearchParams(params);
  const res = await fetch(`${TT_BASE}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const text = await res.text();
  const parsed = await parseStringPromise(text);
  if (parsed.Root && parsed.Root.Error) {
    throw new Error(parsed.Root.Error[0].Error_Message[0]);
  }
  return parsed.Root;
}

async function getValidToken(store) {
  const cached = await store.get('token', { type: 'json' });
  if (cached && cached.validUntil && new Date(cached.validUntil).getTime() - Date.now() > 30 * 60 * 1000) {
    return cached.token;
  }
  const Login = process.env.TRUTRAK_LOGIN;
  const Password = process.env.TRUTRAK_PASSWORD;
  const Skey = process.env.TRUTRAK_SKEY;
  if (!Login || !Password || !Skey) {
    throw new Error('TruTrak credentials are not configured (TRUTRAK_LOGIN/TRUTRAK_PASSWORD/TRUTRAK_SKEY)');
  }
  const root = await ttRequest('TTAuthenticate', { Login, Password, Skey });
  const token = root.Authenticated[0].Token[0];
  const validUntil = root.Authenticated[0].Valid_Until[0];
  await store.setJSON('token', { token, validUntil });
  return token;
}

async function getAssetId(store, token, registration) {
  const cached = await store.get('asset-id', { type: 'json' });
  if (cached && cached.registration === registration && cached.assetId) {
    return cached.assetId;
  }
  const root = await ttRequest('TTAssetsList', {
    Token: token,
    Filter_Registration: registration,
    Filter_Depots: '',
    XMLType: '0'
  });
  const rows = root.Row ? (Array.isArray(root.Row) ? root.Row : [root.Row]) : [];
  if (rows.length === 0) {
    throw new Error(`No TruTrak asset found matching registration "${registration}"`);
  }
  const assetId = field(rows[0], 'ID');
  await store.setJSON('asset-id', { registration, assetId });
  return assetId;
}

async function getCachedPosition(store, registration) {
  const cached = await store.get('location', { type: 'json' });
  const cacheAge = cached ? Date.now() - cached.fetchedAt : Infinity;

  if (cached && cacheAge < LOCATION_CACHE_TTL_MS) {
    return cached.position;
  }

  try {
    const token = await getValidToken(store);
    const assetId = await getAssetId(store, token, registration);
    const root = await ttRequest('TTAssetsLastLocation', {
      Token: token,
      Filter_Assets: String(assetId),
      XMLType: '0'
    });
    const rows = root.Row ? (Array.isArray(root.Row) ? root.Row : [root.Row]) : [];
    if (rows.length === 0) {
      throw new Error('No location data returned from TruTrak (device may not have reported yet)');
    }
    const row = rows[0];
    const position = {
      lat: parseFloat(field(row, 'latitude', '0')),
      lon: parseFloat(field(row, 'longitude', '0')),
      speedMph: parseFloat(field(row, 'speed', '0')),
      headingDeg: parseFloat(field(row, 'heading', '0')),
      status: field(row, 'Status', ''),
      street: field(row, 'street', ''),
      town: field(row, 'town', ''),
      updatedAt: field(row, 'datetimeLocal', null)
    };
    await store.setJSON('location', { position, fetchedAt: Date.now() });
    return position;
  } catch (err) {
    // TruTrak had nothing fresh to give us (common while the sleigh is
    // parked/stationary -- some devices only report on movement). Fall
    // back to the last known-good position rather than telling visitors
    // we've lost the signal entirely, as long as it isn't too old.
    if (cached && cacheAge < POSITION_STALE_MS) {
      return cached.position;
    }
    throw err;
  }
}

export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers });
  }

  try {
    const db = getDatabase();
    const now = new Date();
    const todayDate = londonDateString(now);
    const nowTime = londonTimeString(now);

    const [settingsRows, todayRouteRows] = await Promise.all([
      db.sql`SELECT key, value FROM settings`,
      db.sql`
        SELECT rd.id, rd.route_track, r.name AS route_name
        FROM route_dates rd
        JOIN routes r ON r.id = rd.route_id
        WHERE rd.event_date = ${todayDate}
        ORDER BY rd.id
        LIMIT 1
      `
    ]);

    const settings = {};
    for (const row of settingsRows) settings[row.key] = row.value;

    const windowStart = settings.sightings_window_start || '17:00';
    const windowEnd = settings.sightings_window_end || '22:00';
    const registration = (settings.trutrak_asset_registration || '').trim();

    const todayRoute = todayRouteRows[0] || null;
    const base = {
      todayDate,
      routeName: todayRoute ? todayRoute.route_name : null,
      routeTrack: todayRoute ? todayRoute.route_track : null
    };

    if (!todayRoute) {
      return json({ ...base, active: false, state: 'not-a-route-day' });
    }
    if (nowTime < windowStart) {
      return json({ ...base, active: false, state: 'before-window', windowStart });
    }
    if (nowTime >= windowEnd) {
      return json({ ...base, active: false, state: 'after-window' });
    }

    if (!registration) {
      return json({
        ...base,
        active: true,
        state: 'active',
        position: null,
        positionError: "Live tracking isn't set up yet -- add the sleigh's TruTrak registration in Season Settings."
      });
    }

    const store = getStore('trutrak');
    try {
      const position = await getCachedPosition(store, registration);
      return json({ ...base, active: true, state: 'active', position });
    } catch (err) {
      console.error('TruTrak fetch failed:', err);
      return json({
        ...base,
        active: true,
        state: 'active',
        position: null,
        positionError: "Waiting for a GPS signal from the sleigh..."
      });
    }
  } catch (error) {
    console.error('Error computing tracking data:', error);
    return json({ active: false, state: 'error', error: error.message }, 500);
  }
};
