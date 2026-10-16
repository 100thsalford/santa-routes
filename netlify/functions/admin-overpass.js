// Admin-only server-side proxy for the "Import Streets from Route" OSM
// lookup in admin.html. Browsers can't always read public Overpass
// replies (on 2026-10-16 overpass-api.de answered browser requests
// without a CORS header, so every browser fetch failed), whereas a
// server-side request isn't subject to CORS and can send an identifying
// User-Agent as Overpass's usage policy asks.
//
// Takes the simplified route line (not a raw query) and builds the one
// query itself, so this can't be used as a general Overpass relay.
// Works within ~9s to stay inside the default function timeout; the
// browser falls back to calling Overpass directly if this fails.
//
// Requires a logged-in Identity user with the 'admin' role.

import { getUser } from '@netlify/identity';

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
const USER_AGENT = 'SantaSleighSalford/1.0 (https://santasleighsalford.co.uk, admin street-list import for a volunteer-run Scouts fundraiser)';
const BUDGET_MS = 9000;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers });
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const user = await getUser();
  if (!(user && user.roles && user.roles.includes('admin'))) {
    return json({ error: 'Admin access required' }, 403);
  }

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const coords = Array.isArray(body.coords) ? body.coords : [];
  const radius = Math.round(Number(body.radius));
  if (coords.length < 2 || coords.length > 600) return json({ error: 'coords must have 2-600 points' }, 400);
  if (!(radius >= 10 && radius <= 80)) return json({ error: 'radius must be 10-80 metres' }, 400);
  const parts = [];
  for (const c of coords) {
    const lat = Number(c && c[0]), lon = Number(c && c[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return json({ error: 'Invalid coordinate' }, 400);
    }
    parts.push(lat.toFixed(6) + ',' + lon.toFixed(6));
  }

  const query = '[out:json][timeout:8];way(around:' + radius + ',' + parts.join(',') + ')["highway"]["name"];out tags geom;';
  const deadline = Date.now() + BUDGET_MS;
  const errors = [];

  for (const endpoint of ENDPOINTS) {
    const remaining = deadline - Date.now();
    if (remaining < 1000) break;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), remaining);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
        body: 'data=' + encodeURIComponent(query),
        signal: ctrl.signal
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const elements = (data.elements || [])
        .filter((el) => el.type === 'way' && el.tags && el.tags.name && Array.isArray(el.geometry) && el.geometry.length > 1)
        .map((el) => ({ type: 'way', tags: { name: el.tags.name, highway: el.tags.highway || '' }, geometry: el.geometry }));
      return json({ elements, source: new URL(endpoint).hostname });
    } catch (err) {
      errors.push(new URL(endpoint).hostname + ': ' + (err.name === 'AbortError' ? 'timed out' : err.message));
    } finally {
      clearTimeout(timer);
    }
  }

  console.error('admin-overpass failed:', errors.join('; '));
  return json({ error: 'OpenStreetMap lookup failed (' + errors.join('; ') + ')' }, 502);
};
