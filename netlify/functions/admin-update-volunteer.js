// Admin endpoint to edit a volunteer's role qualifications (Phase 9:
// "Can be Santa / Safety Walker / Driver", matching the Replit reference
// app's volunteer-edit modal) -- these flags are what populate the
// Santa/Safety Walker/Driver dropdowns when creating or editing a sleigh
// night (see admin-routes.js's 'set-event-role' op).
//
// Also (2026-10-21) optionally updates a guest volunteer's own name/
// phone/email -- the only way to fix a typo or add contact details after
// the fact, since a guest has no account/profile page of their own to do
// it themselves. Deliberately scoped to is_guest = true rows only: a
// real account-holder's full_name/email are kept in sync from their own
// Netlify Identity login (see get-volunteer-profile.js), so editing them
// here would just get silently overwritten next time they log in.
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

    // Guest contact-detail edit (name/phone/email) -- only when at least
    // one of these was actually sent, and only ever against a guest row.
    if (body.fullName !== undefined || body.phone !== undefined || body.email !== undefined) {
      const fullName = (body.fullName || '').toString().trim();
      if (!fullName) {
        return new Response(JSON.stringify({ error: 'A name is required' }), { status: 400, headers });
      }
      const phone = body.phone != null && String(body.phone).trim() ? String(body.phone).trim() : null;
      const email = body.email != null && String(body.email).trim() ? String(body.email).trim() : null;
      await db.sql`
        UPDATE volunteers
        SET full_name = ${fullName}, phone = ${phone}, email = ${email}
        WHERE id = ${volunteerId} AND is_guest = true
      `;
    }

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (error) {
    console.error('Error updating volunteer roles:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
