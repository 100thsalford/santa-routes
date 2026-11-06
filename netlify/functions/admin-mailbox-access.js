// Admin-only: give or remove a volunteer's access to the hello@ mailbox in
// the volunteer portal (mailbox.html).
//
// POST body: { volunteerId, enabled: true | false }
// Only approved account holders can be given access -- guests have no login.
// Removing access takes effect on their next mailbox request (every
// mailbox call checks the flag).

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers });
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const user = await getUser();
    if (!(user && user.roles && user.roles.includes('admin'))) return json({ error: 'Admin access required' }, 403);

    const body = await req.json();
    const volunteerId = parseInt(body.volunteerId, 10);
    if (!volunteerId || typeof body.enabled !== 'boolean') {
      return json({ error: 'volunteerId and enabled (true/false) are required' }, 400);
    }

    const db = getDatabase();
    const rows = await db.sql`SELECT is_guest, approval_status FROM volunteers WHERE id = ${volunteerId}`;
    if (!rows.length) return json({ error: 'Volunteer not found' }, 404);
    if (body.enabled && (rows[0].is_guest || rows[0].approval_status !== 'approved')) {
      return json({ error: 'Only approved volunteers with a portal login can be given mailbox access.' }, 409);
    }

    await db.sql`UPDATE volunteers SET mailbox_access = ${body.enabled}, updated_at = NOW() WHERE id = ${volunteerId}`;
    return json({ success: true, mailboxAccess: body.enabled });
  } catch (error) {
    console.error('admin-mailbox-access error:', error);
    return json({ error: error.message }, 500);
  }
};
