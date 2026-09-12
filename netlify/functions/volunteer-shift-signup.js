// Lets a logged-in volunteer self-serve claim an open shift, or cancel
// one of their own shifts up to 24 hours before the route's usual start
// time. Admin-assigned shifts can be cancelled the same way as
// self-claimed ones -- the 24-hour rule is about the shift, not who
// created the assignment.
//
// The 24-hour cutoff is measured from settings.sightings_window_start
// (the same "routes go live at" time the public sightings feature already
// uses) rather than a per-street time, since route_dates doesn't carry
// its own start time.

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';

const headers = { 'Content-Type': 'application/json' };
const TIME_ZONE = 'Europe/London';

// Builds a UTC Date for a London wall-clock date+time by finding the
// London UTC offset that applies on that date and applying it. Good
// enough for a 24-hour cutoff check; not exact to the second around a DST
// transition instant, which doesn't matter here.
function londonPartsToUtc(dateString, timeString) {
  const [h, m] = timeString.split(':').map(Number);
  const naiveUtc = new Date(dateString + 'T' + timeString + ':00Z');
  const londonString = new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(naiveUtc);
  const [lh, lm] = londonString.split(':').map(Number);
  const offsetMinutes = (h * 60 + m) - (lh * 60 + lm);
  return new Date(naiveUtc.getTime() + offsetMinutes * 60000);
}

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
    const routeDateId = parseInt(body.routeDateId, 10);
    if (!routeDateId || (body.op !== 'claim' && body.op !== 'cancel')) {
      return new Response(JSON.stringify({ error: 'routeDateId and a valid op are required' }), { status: 400, headers });
    }

    const db = getDatabase();

    const volRows = await db.sql`
      INSERT INTO volunteers (identity_user_id, email)
      VALUES (${user.id}, ${user.email})
      ON CONFLICT (identity_user_id) DO UPDATE SET email = EXCLUDED.email
      RETURNING id
    `;
    const volunteerId = volRows[0].id;

    const dateRows = await db.sql`
      SELECT to_char(event_date, 'YYYY-MM-DD') AS event_date, volunteer_capacity
      FROM route_dates WHERE id = ${routeDateId}
    `;
    if (dateRows.length === 0) {
      return new Response(JSON.stringify({ error: 'Shift not found' }), { status: 404, headers });
    }
    const eventDate = dateRows[0].event_date;
    const capacity = dateRows[0].volunteer_capacity;

    if (body.op === 'claim') {
      if (capacity != null) {
        const countRows = await db.sql`SELECT COUNT(*) AS n FROM shift_assignments WHERE route_date_id = ${routeDateId}`;
        if (Number(countRows[0].n) >= capacity) {
          return new Response(JSON.stringify({ error: 'full', message: 'This shift is already full.' }), { status: 409, headers });
        }
      }
      await db.sql`
        INSERT INTO shift_assignments (route_date_id, volunteer_id, source)
        VALUES (${routeDateId}, ${volunteerId}, 'self')
        ON CONFLICT (route_date_id, volunteer_id) DO NOTHING
      `;
      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

    // op === 'cancel'
    const settingsRows = await db.sql`SELECT value FROM settings WHERE key = 'sightings_window_start'`;
    const windowStart = (settingsRows[0] && settingsRows[0].value) || '17:00';
    const eventStart = londonPartsToUtc(eventDate, windowStart);
    const cutoff = new Date(eventStart.getTime() - 24 * 60 * 60 * 1000);

    if (new Date() >= cutoff) {
      return new Response(JSON.stringify({
        error: 'tooLate',
        message: 'This shift starts within 24 hours, so please contact an admin to cancel it.'
      }), { status: 409, headers });
    }

    await db.sql`DELETE FROM shift_assignments WHERE route_date_id = ${routeDateId} AND volunteer_id = ${volunteerId}`;
    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (error) {
    console.error('Error in volunteer-shift-signup:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
