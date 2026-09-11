// Admin endpoint to assign/unassign a volunteer to a route_date (a route's
// run on one day). Read back by get-volunteer-profile.js (a volunteer's
// own "My Shifts" list) and by this same admin screen.
//
// Requires a logged-in Identity user with the 'admin' role.

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';

const headers = { 'Content-Type': 'application/json' };

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

    const routeDateId = parseInt(body.routeDateId, 10);
    const volunteerId = parseInt(body.volunteerId, 10);
    if (!routeDateId || !volunteerId) {
      return new Response(JSON.stringify({ error: 'routeDateId and volunteerId are required' }), { status: 400, headers });
    }

    if (body.op === 'unassign') {
      await db.sql`
        DELETE FROM shift_assignments WHERE route_date_id = ${routeDateId} AND volunteer_id = ${volunteerId}
      `;
      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

    const role = body.role != null && String(body.role).trim() ? String(body.role).trim() : null;
    await db.sql`
      INSERT INTO shift_assignments (route_date_id, volunteer_id, role)
      VALUES (${routeDateId}, ${volunteerId}, ${role})
      ON CONFLICT (route_date_id, volunteer_id) DO UPDATE SET role = EXCLUDED.role
    `;

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (error) {
    console.error('Error updating shift assignment:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
