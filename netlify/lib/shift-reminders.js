// Shared "who gets a shift reminder for this date, and what's in it" query,
// used by both the scheduled 7am job (functions/send-shift-reminders.js) and
// the admin "Send tonight's reminders now" button
// (functions/admin-send-reminders.js), so the two can't drift apart.
//
// Someone is "on" for a night if they appear in EITHER:
//   - shift_assignments       -- general volunteers (count towards capacity)
//   - event_role_assignments  -- the Santa / Driver / Safety Walker slots,
//                                kept separate so they don't count towards
//                                capacity (see the Phase 9 migration)
// or both. Each volunteer gets one email covering all their routes that
// night, with any special role flagged on the route it applies to.
//
// Each volunteer also gets a `todo` list for the email's "Before you head
// out" box: the briefing video if they haven't acknowledged it, and Square
// card payments if they haven't signed up (or are still waiting for setup).
// Guests have no portal login, so they get neither; Santa and Driver aren't
// taking card payments, so they don't get the Square one.

import { squareConfigured } from './square.js';

export const EVENT_ROLE_LABELS = {
  santa: 'Santa',
  driver: 'Driver',
  safety_walker: 'Safety Walker'
};

// Returns [{ volunteerId, toEmail, todo: { briefing: bool, square: 'none'|'requested'|null },
//   shifts: [{ routeName, eventDate, role,
//   eventRoles: ['santa'|'driver'|'safety_walker'], streets: [{ name, timeRange }] }] }]
// for volunteers who've opted in to reminder emails. toEmail can be null
// (e.g. a guest volunteer with no email) -- callers skip those.
export async function loadShiftReminders(db, date) {
  const rows = await db.sql`
    SELECT v.id AS volunteer_id, v.email, v.preferred_email, v.is_guest,
           v.briefing_ack_at, v.square_requested_at, v.square_approved_at,
           rd.id AS route_date_id,
           to_char(rd.event_date, 'YYYY-MM-DD') AS event_date,
           CASE WHEN COALESCE(TRIM(r.internal_name), '') <> '' THEN r.name || ' — ' || TRIM(r.internal_name) ELSE r.name END AS route_name,
           sa.role AS shift_role,
           (SELECT string_agg(era.role, ',' ORDER BY era.role)
              FROM event_role_assignments era
             WHERE era.route_date_id = who.route_date_id
               AND era.volunteer_id = who.volunteer_id) AS event_roles
    FROM (
      SELECT route_date_id, volunteer_id FROM shift_assignments
      UNION
      SELECT route_date_id, volunteer_id FROM event_role_assignments WHERE volunteer_id IS NOT NULL
    ) who
    JOIN route_dates rd ON rd.id = who.route_date_id
    JOIN routes r ON r.id = rd.route_id
    JOIN volunteers v ON v.id = who.volunteer_id
    LEFT JOIN shift_assignments sa
      ON sa.route_date_id = who.route_date_id AND sa.volunteer_id = who.volunteer_id
    WHERE rd.event_date = ${date} AND v.reminder_email_opt_in = TRUE
    ORDER BY v.id, rd.id
  `;
  if (rows.length === 0) return [];

  const routeDateIds = Array.from(new Set(rows.map((r) => r.route_date_id)));
  const streetRows = await db.sql`
    SELECT route_date_id, sequence, name, time_range
    FROM streets WHERE route_date_id = ANY(${routeDateIds})
    ORDER BY route_date_id, sequence
  `;
  const streetsByDate = {};
  for (const s of streetRows) {
    (streetsByDate[s.route_date_id] = streetsByDate[s.route_date_id] || []).push({
      name: s.name, timeRange: s.time_range
    });
  }

  const byVolunteer = new Map();
  for (const row of rows) {
    if (!byVolunteer.has(row.volunteer_id)) {
      byVolunteer.set(row.volunteer_id, {
        volunteerId: row.volunteer_id,
        toEmail: row.preferred_email || row.email || null,
        row,
        shifts: []
      });
    }
    byVolunteer.get(row.volunteer_id).shifts.push({
      routeName: row.route_name,
      eventDate: row.event_date,
      role: row.shift_role,
      eventRoles: row.event_roles
        ? row.event_roles.split(',').filter((r) => EVENT_ROLE_LABELS[r])
        : [],
      streets: streetsByDate[row.route_date_id] || []
    });
  }
  const squareOn = squareConfigured();
  return Array.from(byVolunteer.values()).map(function(v) {
    const { row, ...rest } = v;
    return Object.assign(rest, { todo: reminderTodo(row, v.shifts, squareOn) });
  });
}

const NO_CARD_PAYMENT_ROLES = ['santa', 'driver'];

// Exported for tests. row: the volunteer's columns from the query above.
export function reminderTodo(row, shifts, squareOn) {
  if (row.is_guest) return { briefing: false, square: null };
  // Only nudge about Square if they're on at least one route tonight
  // where they're not Santa or the Driver.
  const takesPayments = shifts.some(function(s) {
    return !(s.eventRoles || []).some(function(r) { return NO_CARD_PAYMENT_ROLES.includes(r); });
  });
  let square = null;
  if (squareOn && takesPayments && !row.square_approved_at) {
    square = row.square_requested_at ? 'requested' : 'none';
  }
  return { briefing: !row.briefing_ack_at, square };
}
