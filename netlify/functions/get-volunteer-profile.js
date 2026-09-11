// Returns the logged-in volunteer's profile, creating a row for them on
// first access. Requires a valid Netlify Identity JWT in the Authorization
// header (sent automatically by netlify-identity-widget once logged in).
//
// Shift/route assignment isn't stored yet -- `shifts` is always empty until
// the admin route/street/date management screens (step 4) exist to assign
// volunteers to routes. The front-end shows a "no shifts yet" placeholder
// for an empty array.

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';

const headers = { 'Content-Type': 'application/json' };

export default async (req, context) => {
  try {
    const user = await getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Not logged in' }), { status: 401, headers });
    }

    const db = getDatabase();

    let rows = await db.sql`
      SELECT identity_user_id, email, reminder_email_opt_in, preferred_email
      FROM volunteers WHERE identity_user_id = ${user.id}
    `;

    if (rows.length === 0) {
      rows = await db.sql`
        INSERT INTO volunteers (identity_user_id, email)
        VALUES (${user.id}, ${user.email})
        ON CONFLICT (identity_user_id) DO UPDATE SET email = EXCLUDED.email
        RETURNING identity_user_id, email, reminder_email_opt_in, preferred_email
      `;
    }

    const profile = rows[0];

    return new Response(JSON.stringify({
      email: profile.email,
      reminderEmailOptIn: profile.reminder_email_opt_in,
      preferredEmail: profile.preferred_email,
      shifts: []
    }), { status: 200, headers });
  } catch (error) {
    console.error('Error fetching volunteer profile:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
