// Records that the logged-in volunteer has watched the Volunteer Briefing
// video in the portal. A timestamp on the volunteers row, like risk_ack_at;
// a repeat call keeps the first timestamp. Requires a valid Netlify
// Identity JWT.

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

    const db = getDatabase();

    const access = await getVolunteerAccess(db, user);
    if (access.status !== 'approved') return notApprovedResponse(access.status, headers);

    const rows = await db.sql`
      INSERT INTO volunteers (identity_user_id, email, briefing_ack_at)
      VALUES (${user.id}, ${user.email}, NOW())
      ON CONFLICT (identity_user_id) DO UPDATE SET briefing_ack_at = COALESCE(volunteers.briefing_ack_at, NOW())
      RETURNING briefing_ack_at
    `;

    return new Response(JSON.stringify({ success: true, briefingAckAt: rows[0].briefing_ack_at }), { status: 200, headers });
  } catch (error) {
    console.error('Error acknowledging volunteer briefing:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
