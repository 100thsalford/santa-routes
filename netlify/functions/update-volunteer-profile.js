// Lets a logged-in volunteer update their own reminder-email preference.
// Requires a valid Netlify Identity JWT (see get-volunteer-profile.js).

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';

const headers = { 'Content-Type': 'application/json' };

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const user = await getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Not logged in' }), { status: 401, headers });
    }

    const body = await req.json();
    const reminderEmailOptIn = !!body.reminderEmailOptIn;
    const preferredEmail = typeof body.preferredEmail === 'string' && body.preferredEmail.trim()
      ? body.preferredEmail.trim()
      : null;

    const db = getDatabase();

    const rows = await db.sql`
      INSERT INTO volunteers (identity_user_id, email, reminder_email_opt_in, preferred_email)
      VALUES (${user.id}, ${user.email}, ${reminderEmailOptIn}, ${preferredEmail})
      ON CONFLICT (identity_user_id) DO UPDATE
        SET reminder_email_opt_in = EXCLUDED.reminder_email_opt_in,
            preferred_email = EXCLUDED.preferred_email,
            updated_at = NOW()
      RETURNING email, reminder_email_opt_in, preferred_email
    `;

    const profile = rows[0];

    return new Response(JSON.stringify({
      email: profile.email,
      reminderEmailOptIn: profile.reminder_email_opt_in,
      preferredEmail: profile.preferred_email
    }), { status: 200, headers });
  } catch (error) {
    console.error('Error updating volunteer profile:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
