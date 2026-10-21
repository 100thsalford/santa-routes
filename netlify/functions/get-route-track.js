// Returns a route_date's parsed interactive route track (polyline points +
// turn-by-turn directions, see admin-route-track.js) as JSON, for
// volunteer.html's mobile map. Requires a logged-in Identity user (any
// volunteer or admin) -- same login-gating as get-route-map.js, since
// this is shift-detail data, not public.

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { getVolunteerAccess, notApprovedResponse } from '../lib/volunteer-access.js';

const headers = { 'Content-Type': 'application/json' };

export default async (req, context) => {
  try {
    const user = await getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Not logged in' }), { status: 401, headers });
    }

    const url = new URL(req.url);
    const routeDateId = parseInt(url.searchParams.get('routeDateId'), 10);
    if (!routeDateId) {
      return new Response(JSON.stringify({ error: 'routeDateId is required' }), { status: 400, headers });
    }

    const db = getDatabase();

    const access = await getVolunteerAccess(db, user);
    if (access.status !== 'approved') return notApprovedResponse(access.status, headers);
    const rows = await db.sql`SELECT route_track FROM route_dates WHERE id = ${routeDateId}`;
    if (rows.length === 0 || !rows[0].route_track) {
      return new Response(JSON.stringify({ error: 'No interactive route for this date' }), { status: 404, headers });
    }

    return new Response(JSON.stringify({ track: rows[0].route_track }), {
      status: 200,
      headers: Object.assign({}, headers, { 'Cache-Control': 'private, max-age=300' })
    });
  } catch (error) {
    console.error('Error fetching route track:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
