// Returns the logged-in volunteer's profile, creating a row for them on
// first access. Requires a valid Netlify Identity JWT in the Authorization
// header (sent automatically by netlify-identity-widget once logged in).
//
// `shifts` comes from shift_assignments, populated by the admin "Volunteer
// Shifts" screen (step 4) -- an empty array just means nothing's been
// assigned to this volunteer yet.

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
      SELECT id, identity_user_id, email, reminder_email_opt_in, preferred_email
      FROM volunteers WHERE identity_user_id = ${user.id}
    `;

    if (rows.length === 0) {
      rows = await db.sql`
        INSERT INTO volunteers (identity_user_id, email)
        VALUES (${user.id}, ${user.email})
        ON CONFLICT (identity_user_id) DO UPDATE SET email = EXCLUDED.email
        RETURNING id, identity_user_id, email, reminder_email_opt_in, preferred_email
      `;
    }

    const profile = rows[0];

    const shiftRows = await db.sql`
      SELECT sa.route_date_id, sa.role, r.name AS route_name, to_char(rd.event_date, 'YYYY-MM-DD') AS event_date,
             rd.what3words, rd.notes, rd.route_map_filename
      FROM shift_assignments sa
      JOIN route_dates rd ON sa.route_date_id = rd.id
      JOIN routes r ON rd.route_id = r.id
      WHERE sa.volunteer_id = ${profile.id}
      ORDER BY rd.event_date
    `;

    const shifts = shiftRows.map((s) => ({
      routeDateId: s.route_date_id,
      routeName: s.route_name,
      eventDate: s.event_date,
      role: s.role,
      what3words: s.what3words,
      notes: s.notes,
      hasRouteMap: !!s.route_map_filename
    }));

    return new Response(JSON.stringify({
      email: profile.email,
      reminderEmailOptIn: profile.reminder_email_opt_in,
      preferredEmail: profile.preferred_email,
      shifts
    }), { status: 200, headers });
  } catch (error) {
    console.error('Error fetching volunteer profile:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
