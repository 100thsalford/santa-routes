// Admin endpoint to edit a volunteer's role qualifications (Phase 9:
// "Can be Santa / Safety Walker / Driver", matching the Replit reference
// app's volunteer-edit modal) -- these flags are what populate the
// Santa/Safety Walker/Driver dropdowns when creating or editing a sleigh
// night (see admin-routes.js's 'set-event-role' op).
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
    const volunteerId = parseInt(body.volunteerId, 10);
    if (!volunteerId) {
      return new Response(JSON.stringify({ error: 'volunteerId is required' }), { status: 400, headers });
    }

    const db = getDatabase();
    await db.sql`
      UPDATE volunteers
      SET can_be_santa = ${!!body.canBeSanta},
          can_be_safety_walker = ${!!body.canBeSafetyWalker},
          can_be_driver = ${!!body.canBeDriver}
      WHERE id = ${volunteerId}
    `;

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (error) {
    console.error('Error updating volunteer roles:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
