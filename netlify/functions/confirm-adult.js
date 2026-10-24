// Records the logged-in volunteer's one-time confirmation that they are 18
// or over (the volunteer portal is adults-only -- privacy policy). Asked for
// once, on first portal visit after this was introduced; new registrations
// on the helpout page confirm it at sign-up instead. Self-serve shift
// signup (volunteer-shift-signup.js) refuses until it's on file.

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
    if (body.confirmed !== true) {
      return new Response(JSON.stringify({ error: 'Confirmation required' }), { status: 400, headers });
    }

    const db = getDatabase();
    const access = await getVolunteerAccess(db, user);
    if (access.status !== 'approved') return notApprovedResponse(access.status, headers);

    const rows = await db.sql`
      UPDATE volunteers SET adult_confirmed_at = COALESCE(adult_confirmed_at, NOW())
      WHERE identity_user_id = ${user.id}
      RETURNING adult_confirmed_at
    `;
    if (!rows.length) {
      return new Response(JSON.stringify({ error: 'Volunteer not found' }), { status: 404, headers });
    }
    return new Response(JSON.stringify({ success: true, adultConfirmedAt: rows[0].adult_confirmed_at }), { status: 200, headers });
  } catch (error) {
    console.error('Error confirming age:', error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
