// Public-ish endpoint (no login required) that lists upcoming route_dates
// with their volunteer capacity and current signup count, so the
// volunteer portal can show "open shifts" with a status badge and let a
// logged-in volunteer claim one. If an Authorization header is present and
// valid, each date also reports whether the current volunteer is already
// signed up for it.
//
// Status per date:
//   'uncapped' -- no volunteer_capacity set, so no target to compare against
//   'full'     -- signupCount >= capacity
//   'urgent'   -- signupCount is 0, or under half of capacity
//   'open'     -- some spots filled, under capacity, not urgent

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Content-Type': 'application/json'
};

function londonDateString(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

function shiftStatus(capacity, signupCount) {
  if (capacity == null) return 'uncapped';
  if (signupCount >= capacity) return 'full';
  if (signupCount === 0 || signupCount / capacity <= 0.5) return 'urgent';
  return 'open';
}

export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers });
  }

  try {
    const db = getDatabase();
    const todayDate = londonDateString(new Date());

    const user = await getUser();
    let volunteerId = null;
    if (user) {
      const rows = await db.sql`SELECT id FROM volunteers WHERE identity_user_id = ${user.id}`;
      if (rows.length > 0) volunteerId = rows[0].id;
    }

    const rows = await db.sql`
      SELECT
        rd.id, r.name AS route_name, to_char(rd.event_date, 'YYYY-MM-DD') AS event_date,
        rd.volunteer_capacity, rd.what3words, rd.notes, rd.route_map_filename,
        COUNT(sa.id) AS signup_count,
        BOOL_OR(sa.volunteer_id = ${volunteerId}) AS viewer_signed_up
      FROM route_dates rd
      JOIN routes r ON rd.route_id = r.id
      LEFT JOIN shift_assignments sa ON sa.route_date_id = rd.id
      WHERE rd.event_date >= ${todayDate}
      GROUP BY rd.id, r.name, rd.event_date, rd.volunteer_capacity, rd.what3words, rd.notes, rd.route_map_filename, r.display_order
      ORDER BY rd.event_date, r.display_order NULLS LAST, r.name
    `;

    const shifts = rows.map((r) => {
      const capacity = r.volunteer_capacity != null ? Number(r.volunteer_capacity) : null;
      const signupCount = Number(r.signup_count);
      return {
        id: r.id,
        routeName: r.route_name,
        eventDate: r.event_date,
        capacity,
        signupCount,
        status: shiftStatus(capacity, signupCount),
        viewerSignedUp: !!r.viewer_signed_up,
        what3words: r.what3words,
        notes: r.notes,
        hasRouteMap: !!r.route_map_filename
      };
    });

    return new Response(JSON.stringify({ shifts }), { status: 200, headers });
  } catch (error) {
    console.error('Error fetching shift openings:', error);
    return new Response(JSON.stringify({ error: error.message, shifts: [] }), { status: 200, headers });
  }
};
