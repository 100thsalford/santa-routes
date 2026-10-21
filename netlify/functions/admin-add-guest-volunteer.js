// Admin endpoint to add a "guest" volunteer: a name (required) plus
// optional phone/email, with no Netlify Identity account attached. Lets
// an admin schedule a helper who doesn't want/need a login into shifts
// and Santa/Safety-Walker/Driver roles exactly like any other volunteer
// -- every other admin/volunteer-portal query already joins against
// volunteers.id, not identity_user_id, so a guest row just works there
// unchanged.
//
// The optional phone/email are for the admin's own reference only (e.g.
// to remind a guest by text) -- they are not used by the automated
// Resend reminder emails, which only ever go to logged-in volunteers.
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
    const fullName = (body.fullName || '').toString().trim();
    if (!fullName) {
      return new Response(JSON.stringify({ error: 'A name is required' }), { status: 400, headers });
    }
    const phone = body.phone != null && String(body.phone).trim() ? String(body.phone).trim() : null;
    const email = body.email != null && String(body.email).trim() ? String(body.email).trim() : null;

    const db = getDatabase();
    const rows = await db.sql`
      INSERT INTO volunteers (identity_user_id, email, full_name, phone, is_guest)
      VALUES (NULL, ${email}, ${fullName}, ${phone}, true)
      RETURNING id
    `;

    return new Response(JSON.stringify({ success: true, id: rows[0].id }), { status: 200, headers });
  } catch (error) {
    console.error('Error adding guest volunteer:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
