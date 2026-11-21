// Who an admin broadcast goes to -- shared by the broadcast email
// (functions/admin-broadcast-email.js) and the "send push now" panel
// (functions/admin-send-push.js) so the two audiences always match.
//
// scope:
//   'all'          -- every approved volunteer
//   'event'        -- everyone on one route_date (routeDateId): signed up
//                     to it, or holding its Santa / Driver / Safety Walker slot
//   'tonight'      -- everyone on any route_date dated today (Europe/London)
//   'no_upcoming'  -- approved volunteers with a login who have no shift or
//                     role slot on a night from today onwards (guests are
//                     left out: they have no login to sign up with)
//
// Returns [{ id, email, preferred_email, full_name }].

export const SCOPES = ['all', 'event', 'tonight', 'no_upcoming'];

export function londonDateString(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date || new Date());
}

export async function findRecipients(db, scope, routeDateId) {
  if (scope === 'event' || scope === 'tonight') {
    const today = londonDateString(new Date());
    const dateIds = scope === 'event'
      ? [Number(routeDateId)]
      : (await db.sql`SELECT id FROM route_dates WHERE event_date = ${today}`).map((r) => r.id);
    if (!dateIds.length || dateIds.some((n) => !Number.isInteger(n))) return [];
    return db.sql`
      SELECT DISTINCT v.id, v.email, v.preferred_email, v.full_name
      FROM volunteers v
      WHERE v.id IN (
        SELECT volunteer_id FROM shift_assignments WHERE route_date_id = ANY(${dateIds})
        UNION
        SELECT volunteer_id FROM event_role_assignments
        WHERE route_date_id = ANY(${dateIds}) AND volunteer_id IS NOT NULL
      )
    `;
  }
  if (scope === 'no_upcoming') {
    const today = londonDateString(new Date());
    return db.sql`
      SELECT v.id, v.email, v.preferred_email, v.full_name
      FROM volunteers v
      WHERE v.approval_status = 'approved'
        AND NOT v.is_guest
        AND NOT EXISTS (
          SELECT 1 FROM shift_assignments sa
          JOIN route_dates rd ON rd.id = sa.route_date_id
          WHERE sa.volunteer_id = v.id AND rd.event_date >= ${today}
        )
        AND NOT EXISTS (
          SELECT 1 FROM event_role_assignments era
          JOIN route_dates rd ON rd.id = era.route_date_id
          WHERE era.volunteer_id = v.id AND rd.event_date >= ${today}
        )
      ORDER BY COALESCE(v.full_name, v.email)
    `;
  }
  return db.sql`SELECT id, email, preferred_email, full_name FROM volunteers WHERE approval_status = 'approved'`;
}

export function displayName(row) {
  return row.full_name || row.preferred_email || row.email;
}
