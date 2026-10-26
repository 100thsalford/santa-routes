// Records that the logged-in volunteer has started, finished or dismissed
// ("Don't show this again") the volunteer.html welcome tour, so it isn't
// shown again on their next login. "Show me later" doesn't call this.
// Stores the highest tour version seen (see portal_tour_version).

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { getVolunteerAccess, notApprovedResponse } from '../lib/volunteer-access.js';

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const user = await getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Not logged in' }), { status: 401, headers });
    }
    const body = await req.json().catch(() => ({}));
    const version = Number(body.version);
    if (!Number.isInteger(version) || version < 1 || version > 1000) {
      return new Response(JSON.stringify({ error: 'Invalid tour version' }), { status: 400, headers });
    }

    const db = getDatabase();
    const access = await getVolunteerAccess(db, user);
    if (access.status !== 'approved') return notApprovedResponse(access.status, headers);

    const rows = await db.sql`
      UPDATE volunteers SET portal_tour_version = GREATEST(portal_tour_version, ${version})
      WHERE identity_user_id = ${user.id}
      RETURNING portal_tour_version
    `;
    if (!rows.length) {
      return new Response(JSON.stringify({ error: 'Volunteer not found' }), { status: 404, headers });
    }
    return new Response(JSON.stringify({ success: true, portalTourVersion: rows[0].portal_tour_version }), { status: 200, headers });
  } catch (error) {
    console.error('Error saving portal tour state:', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
