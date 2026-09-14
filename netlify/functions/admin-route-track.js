// Admin set/delete for a route_date's interactive route track (polyline +
// turn-by-turn directions), parsed client-side in admin.html from a
// plotaroute.com GPX export and stored as JSONB on route_dates.route_track.
// Supplements route_map_key/filename (the static image/PDF, see
// admin-route-map.js) rather than replacing it -- volunteer.html falls
// back to the static map for any date with no parsed track yet.
//
// Kept as its own file rather than folded into admin-routes.js's
// op-dispatch, matching the precedent admin-route-map.js already set
// (upload/derived-data work stays separate from that function's plain
// field updates).
//
// Requires a logged-in Identity user with the 'admin' role.

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';

const headers = { 'Content-Type': 'application/json' };
const MAX_POINTS = 3000;
const MAX_DIRECTIONS = 300;

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
    const routeDateId = parseInt(body.routeDateId, 10);
    if (!routeDateId) {
      return new Response(JSON.stringify({ error: 'routeDateId is required' }), { status: 400, headers });
    }

    const db = getDatabase();

    if (body.op === 'delete') {
      await db.sql`UPDATE route_dates SET route_track = NULL WHERE id = ${routeDateId}`;
      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

    if (body.op !== 'set') {
      return new Response(JSON.stringify({ error: 'Unknown op' }), { status: 400, headers });
    }

    const track = body.track;
    if (!track || !Array.isArray(track.points) || !Array.isArray(track.directions)) {
      return new Response(JSON.stringify({ error: 'track.points and track.directions arrays are required' }), { status: 400, headers });
    }
    if (track.points.length < 2 || track.points.length > MAX_POINTS) {
      return new Response(JSON.stringify({ error: 'track.points must have between 2 and ' + MAX_POINTS + ' points' }), { status: 400, headers });
    }
    if (track.directions.length === 0 || track.directions.length > MAX_DIRECTIONS) {
      return new Response(JSON.stringify({ error: 'track.directions must have between 1 and ' + MAX_DIRECTIONS + ' entries' }), { status: 400, headers });
    }

    const rows = await db.sql`SELECT id FROM route_dates WHERE id = ${routeDateId}`;
    if (rows.length === 0) {
      return new Response(JSON.stringify({ error: 'Date not found' }), { status: 404, headers });
    }

    await db.sql`
      UPDATE route_dates SET route_track = ${JSON.stringify(track)}::jsonb WHERE id = ${routeDateId}
    `;

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (error) {
    console.error('Error in admin-route-track:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
