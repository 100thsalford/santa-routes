// Returns everything the admin screens (admin.html) need in one bulk fetch:
// the full routes -> dates -> streets tree, the settings table, and every
// volunteer with their current shift assignments. Data volumes here are
// small (~10 routes, ~10 dates, ~160 streets, a handful of volunteers per
// season) so one bulk fetch is simpler and fast enough rather than paging.
//
// Requires a logged-in Identity user with the 'admin' role (set via
// app_metadata.roles in the Netlify dashboard).

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';

const headers = { 'Content-Type': 'application/json' };

function requireAdmin(user) {
  return !!(user && user.roles && user.roles.includes('admin'));
}

export default async (req, context) => {
  try {
    const user = await getUser();
    if (!requireAdmin(user)) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers });
    }

    const db = getDatabase();

    const [routeRows, dateRows, streetRows, settingsRows, volunteerRows, assignmentRows] = await Promise.all([
      db.sql`SELECT id, name, display_order FROM routes ORDER BY display_order NULLS LAST, name`,
      db.sql`SELECT id, route_id, to_char(event_date, 'YYYY-MM-DD') AS event_date, amount_collected FROM route_dates ORDER BY event_date`,
      db.sql`SELECT id, route_date_id, sequence, name, time_range FROM streets ORDER BY route_date_id, sequence`,
      db.sql`SELECT key, value FROM settings`,
      db.sql`SELECT id, email, reminder_email_opt_in FROM volunteers ORDER BY email`,
      db.sql`
        SELECT sa.id, sa.route_date_id, sa.volunteer_id, sa.role,
               r.name AS route_name, to_char(rd.event_date, 'YYYY-MM-DD') AS event_date
        FROM shift_assignments sa
        JOIN route_dates rd ON sa.route_date_id = rd.id
        JOIN routes r ON rd.route_id = r.id
        ORDER BY rd.event_date
      `
    ]);

    const streetsByDate = {};
    for (const s of streetRows) {
      (streetsByDate[s.route_date_id] = streetsByDate[s.route_date_id] || []).push({
        id: s.id, sequence: s.sequence, name: s.name, timeRange: s.time_range
      });
    }

    const datesByRoute = {};
    for (const d of dateRows) {
      (datesByRoute[d.route_id] = datesByRoute[d.route_id] || []).push({
        id: d.id,
        eventDate: d.event_date,
        year: parseInt(d.event_date.slice(0, 4), 10),
        amountCollected: d.amount_collected != null ? Number(d.amount_collected) : null,
        streets: streetsByDate[d.id] || []
      });
    }

    const years = Array.from(new Set(dateRows.map((d) => parseInt(d.event_date.slice(0, 4), 10)))).sort();

    const routes = routeRows.map((r) => ({
      id: r.id,
      name: r.name,
      displayOrder: r.display_order,
      dates: datesByRoute[r.id] || []
    }));

    const settings = {};
    for (const row of settingsRows) settings[row.key] = row.value;

    const assignmentsByVolunteer = {};
    for (const a of assignmentRows) {
      (assignmentsByVolunteer[a.volunteer_id] = assignmentsByVolunteer[a.volunteer_id] || []).push({
        routeDateId: a.route_date_id,
        routeName: a.route_name,
        eventDate: a.event_date,
        role: a.role
      });
    }

    const volunteers = volunteerRows.map((v) => ({
      id: v.id,
      email: v.email,
      reminderEmailOptIn: v.reminder_email_opt_in,
      shifts: assignmentsByVolunteer[v.id] || []
    }));

    return new Response(JSON.stringify({ routes, settings, volunteers, years }), { status: 200, headers });
  } catch (error) {
    console.error('Error fetching admin data:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
