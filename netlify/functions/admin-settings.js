// Admin write endpoint for the settings table (season lead/trail days,
// sightings time window) -- the values get-site-status.js reads to decide
// whether the season/sightings are currently active.
//
// Requires a logged-in Identity user with the 'admin' role.

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';

const headers = { 'Content-Type': 'application/json' };

const ALLOWED_KEYS = [
  'season_lead_days',
  'season_trail_days',
  'sightings_window_start',
  'sightings_window_end',
  'risk_assessment_text',
  'risk_assessment_url'
];

function requireAdmin(user) {
  return !!(user && user.roles && user.roles.includes('admin'));
}

export default async (req, context) => {
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
};
