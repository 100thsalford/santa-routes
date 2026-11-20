// Admin write endpoint for the settings table (season lead/trail days,
// sightings time window) -- the values get-site-status.js reads to decide
// whether the season/sightings are currently active.
//
// Requires a logged-in Identity user with the 'admin' role.

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { purgePublicCache, CACHE_TAGS } from '../lib/cdn-cache.js';
import { londonMidnightAfter } from '../lib/tracking-window.js';

const headers = { 'Content-Type': 'application/json' };

const ALLOWED_KEYS = [
  'season_lead_days',
  'season_trail_days',
  'sightings_window_start',
  'sightings_window_end',
  'risk_assessment_text',
  'risk_assessment_url',
  'trutrak_asset_registration',
  'tracking_window_start',
  'tracking_window_end',
  'signup_code',
  'registration_notify_email'
];

const TIME_KEYS = ['sightings_window_start', 'sightings_window_end', 'tracking_window_start', 'tracking_window_end'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// Live-tracking override durations offered on the Dashboard.
const ON_DURATIONS_MS = { '1h': 3600000, '2h': 7200000, '4h': 14400000 };

function requireAdmin(user) {
  return !!(user && user.roles && user.roles.includes('admin'));
}

// Any saved setting (windows, season days, tracking override) changes what
// the public site-status and tracking endpoints return, so clear their CDN
// copies before replying -- the change is live as soon as the admin sees it.
export default async (req, context) => {
  const res = await handle(req, context);
  if (res.status === 200) {
    await purgePublicCache([CACHE_TAGS.siteStatus, CACHE_TAGS.tracking], { retry: true });
  }
  return res;
};

function badRequest(message) {
  return new Response(JSON.stringify({ error: message }), { status: 400, headers });
}

async function handle(req, context) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const user = await getUser();
    if (!requireAdmin(user)) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers });
    }

    const body = await req.json();
    const db = getDatabase();

    // Live-tracking override (Dashboard Auto / On / Off) -- see
    // lib/tracking-window.js for how it's applied.
    //   auto: back to the route-night schedule
    //   on:   visibility 'public' | 'admin'; duration '1h'|'2h'|'4h'|'midnight'
    //         (always expires, so the sleigh's parked spot can't be left public)
    //   off:  duration 'midnight' (rest of today) | 'indefinite'
    if (body.op === 'set-tracking-override') {
      const now = new Date();
      const mode = body.mode;
      let values;
      if (mode === 'auto') {
        values = { mode: '', visibility: '', from: '', until: '' };
      } else if (mode === 'on') {
        const visibility = body.visibility === 'admin' ? 'admin' : body.visibility === 'public' ? 'public' : null;
        if (!visibility) return badRequest('Choose who can see the tracker');
        let until;
        if (body.duration === 'midnight') until = londonMidnightAfter(now);
        else if (ON_DURATIONS_MS[body.duration]) until = new Date(now.getTime() + ON_DURATIONS_MS[body.duration]);
        else return badRequest('Choose how long to switch tracking on for');
        values = { mode: 'on', visibility, from: now.toISOString(), until: until.toISOString() };
      } else if (mode === 'off') {
        let until;
        if (body.duration === 'midnight') until = londonMidnightAfter(now).toISOString();
        else if (body.duration === 'indefinite') until = '';
        else return badRequest('Choose how long to switch tracking off for');
        values = { mode: 'off', visibility: '', from: now.toISOString(), until };
      } else {
        return badRequest('Unknown tracking mode');
      }
      const rows = [
        ['tracking_override_mode', values.mode],
        ['tracking_override_visibility', values.visibility],
        ['tracking_override_from', values.from],
        ['tracking_override_until', values.until],
        ['tracking_stopped_date', ''] // retired "stop now" switch
      ];
      for (const [key, value] of rows) {
        await db.sql`
          INSERT INTO settings (key, value, updated_at) VALUES (${key}, ${value}, NOW())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `;
      }
      return new Response(JSON.stringify({ success: true, override: values }), { status: 200, headers });
    }

    for (const key of TIME_KEYS) {
      if (body[key] !== undefined && String(body[key]).trim() !== '' && !TIME_RE.test(String(body[key]).trim())) {
        return new Response(JSON.stringify({ error: key.replace(/_/g, ' ') + ' must be a 24hr time like 21:30' }), { status: 400, headers });
      }
    }

    for (const key of ALLOWED_KEYS) {
      if (body[key] === undefined) continue;
      const value = String(body[key]).trim();
      await db.sql`
        INSERT INTO settings (key, value, updated_at) VALUES (${key}, ${value}, NOW())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `;
    }

    const rows = await db.sql`SELECT key, value FROM settings`;
    const settings = {};
    for (const row of rows) settings[row.key] = row.value;

    return new Response(JSON.stringify({ success: true, settings }), { status: 200, headers });
  } catch (error) {
    console.error('Error updating settings:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}
