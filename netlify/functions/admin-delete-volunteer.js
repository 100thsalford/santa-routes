// Admin-only: permanently delete a volunteer -- used for the 3-year
// inactivity review ("Review for deletion" on the admin Volunteers tab) and
// for erasure requests.
//
// Removes, in order: their Netlify Identity account (if they have one),
// their invite records, then the volunteers row itself. shift_assignments
// rows go with it (ON DELETE CASCADE) and any Santa/Safety Walker/Driver
// slot is cleared (ON DELETE SET NULL). If they had card payment access,
// their Square team member is deactivated. Copies of past emails held by
// Resend are not touched here.
//
// POST body: { volunteerId }

import { getUser, admin } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { setTeamMemberStatus } from '../lib/square.js';

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers });
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const user = await getUser();
    if (!(user && user.roles && user.roles.includes('admin'))) {
      return json({ error: 'Admin access required' }, 403);
    }

    const body = await req.json();
    const volunteerId = parseInt(body.volunteerId, 10);
    if (!volunteerId) return json({ error: 'volunteerId is required' }, 400);

    const db = getDatabase();
    const rows = await db.sql`SELECT identity_user_id, square_team_member_id FROM volunteers WHERE id = ${volunteerId}`;
    if (rows.length === 0) return json({ error: 'Volunteer not found' }, 404);

    const identityId = rows[0].identity_user_id;
    if (identityId) {
      if (identityId === user.id) return json({ error: "You can't delete your own account here" }, 400);
      try {
        await admin.deleteUser(identityId);
      } catch (err) {
        // Already gone from Identity is fine; anything else stops the delete
        // so we don't leave a login with no volunteer record behind.
        if (!/not\s*found|404/i.test(String(err && err.message))) {
          console.error('admin-delete-volunteer: Identity delete failed:', err.message);
          return json({ error: 'Could not delete their login account: ' + err.message }, 502);
        }
      }
    }

    if (rows[0].square_team_member_id) {
      try {
        await setTeamMemberStatus(rows[0].square_team_member_id, 'INACTIVE');
      } catch (err) {
        // Don't block an erasure on Square; flag it in the logs instead.
        console.error('admin-delete-volunteer: Square deactivate failed (deactivate by hand):', err.message);
      }
    }

    await db.sql`DELETE FROM volunteer_invites WHERE volunteer_id = ${volunteerId}`;
    await db.sql`DELETE FROM volunteers WHERE id = ${volunteerId}`;

    return json({ success: true });
  } catch (error) {
    console.error('Error deleting volunteer:', error.message);
    return json({ error: error.message }, 500);
  }
};
