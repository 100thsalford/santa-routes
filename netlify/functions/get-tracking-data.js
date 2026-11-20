// Public endpoint powering track.html's live sleigh map -- replaces the
// old Glympse-based "Track Santa Live" button. Determines whether tonight
// is a route night and whether we're inside the live-tracking window (see
// trackingWindow() in lib/tracking-window.js: its own admin settings, an
// optional per-night end time, and the admin Auto/On/Off override), and
// -- only while that
// window is open -- fetches the sleigh's current GPS position from TruTrak (the
// FMT200 device fitted to the sleigh) plus a breadcrumb trail of where
// it's actually been tonight (via TTAssetsTrail), shown alongside the
// dashed planned route already drawn from route_dates.route_track.
//
// Credentials (TRUTRAK_LOGIN/PASSWORD/SKEY) never leave this function --
// the browser only ever sees the parsed position/trail JSON below.
// TruTrak's ASMX web service accepts a plain HTTP POST (not a full SOAP
// envelope) and returns bare XML -- see TruTrak API V1.0.1 docs. Auth
// tokens (24h validity) and the resolved Asset_ID are cached in Netlify
// Blobs so a burst of simultaneous visitors doesn't multiply TruTrak API
// calls or re-authenticate on every request; the last known position and
// trail are also cached (LOCATION_CACHE_TTL_MS) for the same reason --
// TruTrak's own guidance is a hard limit of one call per 30s, "preferably"
// one per minute, and this function makes up to two calls (position +
// trail) per refresh cycle to respect that.
//
// Which physical asset is "the sleigh" is an admin setting
// (settings.trutrak_asset_registration, e.g. "PZ54 GDX") rather than a
// hardcoded env var -- see admin-trutrak-assets.js for the admin-side
// lookup helper, and admin-settings.js for where it's saved.
//
// NOTE on TTAssetsTrail's Date_Start/Date_End format: TruTrak's docs
// don't give an explicit example for this method. We format them the same
// "no UTC offset" ISO style TruTrak uses everywhere else in its responses
// (e.g. datetimeLocal, Valid_Until). Untested against a real asset as of
// 2026-09-14 -- worth confirming the trail actually populates once real
// GPS data is flowing, and adjusting the format here if not.

import { getDatabase } from '@netlify/database';
import { getStore } from '@netlify/blobs';
import { parseStringPromise } from 'xml2js';
import { getUser } from '@netlify/identity';
import { cdnCacheHeaders, CACHE_TAGS } from '../lib/cdn-cache.js';
import { trackingWindow, londonDateString, londonLocalStamp } from '../lib/tracking-window.js';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'
};

const TT_BASE = 'https://ttapi.trutrakpro.co.uk/WSDataProvider.asmx';
const LOCATION_CACHE_TTL_MS = 60000; // TruTrak's own stated limit is 1 call every 30s minimum, "preferably" 1/min -- we default to their preferred cadence rather than the bare minimum
const POSITION_STALE_MS = 10 * 60 * 1000; // if a fresh TruTrak read fails or comes back empty (e.g. the sleigh is parked/stationary between GPS pings), keep showing the last known position for up to 10 minutes rather than flipping straight to "no signal"

// Every open track.html polls this every 30s, and on a route night that
// can be hundreds of tabs. The CDN shares one answer between them for 15s
// (well inside the 60s the TruTrak position itself is cached for, so the
// map is no less live). No stale-while-revalidate, so once the window
// closes no position is served for more than 15s; admin override changes
// purge it straight away (admin-settings.js). Errors are never cached, and
// neither are admin previews (?preview=1), which may show a position the
// public must not see.
const cacheHeaders = cdnCacheHeaders({ maxAge: 15, tags: [CACHE_TAGS.tracking] });

function json(body, status = 200, { cache = true } = {}) {
  const h = status === 200 && cache ? { ...headers, ...cacheHeaders } : headers;
  return new Response(JSON.stringify(body), { status, headers: h });
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

// dateStart/dateEnd are TruTrak local stamps ("2026-12-01T17:00:00");
// cacheKey must start "trail-<London date>" (purge-old-logs.js keeps
// today's and yesterday's by that prefix).
async function getAssetTrail(store, registration, cacheKey, dateStart, dateEnd) {
  const cached = await store.get(cacheKey, { type: 'json' });
  if (cached && Date.now() - cached.fetchedAt < LOCATION_CACHE_TTL_MS) {
    return cached.points;
  }

  try {
    const token = await getValidToken(store);
    const assetId = await getAssetId(store, token, registration);
    // dateEnd is capped at the window end / override expiry so the trail
    // can never reveal where the sleigh went after tracking stopped (e.g.
    // where it's parked).
    const root = await ttRequest('TTAssetsTrail', {
      Token: token,
      asset_ID: String(assetId),
      Date_Start: dateStart,
      Date_End: dateEnd,
      XMLType: '0'
    });
    const rows = root.Row ? (Array.isArray(root.Row) ? root.Row : [root.Row]) : [];
    const points = rows
      .map((row) => [parseFloat(field(row, 'latitude', '')), parseFloat(field(row, 'longitude', ''))])
      .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    // Only overwrite the cache with a non-empty result -- an empty/failed
    // fetch shouldn't erase a trail we'd already built up this evening.
    if (points.length > 0) {
      await store.setJSON(cacheKey, { points, fetchedAt: Date.now() });
    }
    return points.length > 0 ? points : (cached ? cached.points : []);
  } catch (err) {
    console.error('TruTrak trail fetch failed:', err);
    // Non-critical -- the live dot and planned route still work fine
    // without a trail, so just fall back to whatever we last had.
    return cached ? cached.points : [];
  }
}

function isAdmin(user) {
  return !!(user && user.roles && user.roles.includes('admin'));
}

export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers });
  }

  try {
    const db = getDatabase();
    const now = new Date();
    const todayDate = londonDateString(now);

    // Admin preview (track.html?preview=1, sent with the admin's Identity
    // token): lets an admin-only "On" override apply. Never CDN-cached.
    const wantsPreview = new URL(req.url).searchParams.get('preview') === '1';
    let preview = false;
    if (wantsPreview) {
      try { preview = isAdmin(await getUser()); } catch (e) { preview = false; }
    }
    let win;
    const reply = (body) => json(preview ? { ...body, preview: true, override: win.override } : body, 200, { cache: !wantsPreview });

    const [settingsRows, todayRouteRows] = await Promise.all([
      db.sql`SELECT key, value FROM settings`,
      db.sql`
        SELECT rd.id, rd.route_track, rd.tracking_end_time, r.name AS route_name
        FROM route_dates rd
        JOIN routes r ON r.id = rd.route_id
        WHERE rd.event_date = ${todayDate}
        ORDER BY rd.id
        LIMIT 1
      `
    ]);

    const settings = {};
    for (const row of settingsRows) settings[row.key] = row.value;

    const todayRoute = todayRouteRows[0] || null;
    win = trackingWindow(settings, todayRoute, now, { viewerIsAdmin: preview });
    const windowStart = win.start;
    const registration = (settings.trutrak_asset_registration || '').trim();

    const base = {
      todayDate,
      routeName: todayRoute ? todayRoute.route_name : null,
      routeTrack: todayRoute ? todayRoute.route_track : null
    };

    // Outside the live window nothing from TruTrak is fetched or
    // returned at all -- no position and no trail -- so a bookmarked
    // track.html shows nothing once tracking has stopped for the night.
    if (win.state === 'not-a-route-day') {
      return reply({ ...base, active: false, state: 'not-a-route-day' });
    }
    if (win.state === 'before-window') {
      return reply({ ...base, active: false, state: 'before-window', windowStart });
    }
    if (win.state === 'after-window' || win.state === 'stopped') {
      return reply({ ...base, active: false, state: win.state });
    }

    // Trail: tonight's window on a scheduled night; from the moment the
    // override was switched on (never earlier) when forced on.
    let trailKey, trailStart, trailEnd;
    if (win.forced) {
      const from = new Date(win.override.from || now);
      trailKey = `trail-${todayDate}-ov${from.getTime()}`;
      trailStart = londonLocalStamp(from);
      trailEnd = londonLocalStamp(new Date(win.override.until));
    } else {
      trailKey = `trail-${todayDate}`;
      trailStart = `${todayDate}T${win.start}:00`;
      trailEnd = `${todayDate}T${win.end}:00`;
    }
    const live = { ...base, active: true, state: 'active', forced: win.forced, windowEnd: win.end };

    const store = getStore('trutrak');
    const trail = registration ? await getAssetTrail(store, registration, trailKey, trailStart, trailEnd) : [];

    if (!registration) {
      return reply({
        ...live,
        position: null,
        trail,
        positionError: "Live tracking isn't set up yet -- add the sleigh's TruTrak registration in Season Settings."
      });
    }

    try {
      const position = await getCachedPosition(store, registration);
      return reply({ ...live, position, trail });
    } catch (err) {
      console.error('TruTrak fetch failed:', err);
      return reply({
        ...live,
        position: null,
        trail,
        positionError: "Waiting for a GPS signal from the sleigh..."
      });
    }
  } catch (error) {
    console.error('Error computing tracking data:', error);
    return json({ active: false, state: 'error', error: error.message }, 500);
  }
};
