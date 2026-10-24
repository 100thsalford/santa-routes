// Volunteer retention rule (privacy policy): a volunteer with no login and
// no volunteering activity for 3 years is flagged to admins for manual
// review and deletion. "Activity" is the latest of: last portal visit
// (last_active_at), when the record was created, and the date of any night
// they were booked on as a volunteer or in a Santa/Safety Walker/Driver
// role -- so guests with no login are judged on their shifts, and someone
// booked on a future night is never flagged.
//
// Used by purge-old-logs.js (monthly admin email) and admin-data.js (the
// "Review for deletion" list on the admin Volunteers tab).

export const INACTIVITY_INTERVAL = '3 years';

export async function findInactiveVolunteers(db) {
  return db.sql`
    WITH activity AS (
      SELECT v.id, v.full_name, v.email, v.is_guest,
        GREATEST(
          COALESCE(v.last_active_at, 'epoch'::timestamptz),
          COALESCE(v.created_at::timestamptz, 'epoch'::timestamptz),
          COALESCE((SELECT MAX(rd.event_date) FROM shift_assignments sa
                    JOIN route_dates rd ON rd.id = sa.route_date_id
                    WHERE sa.volunteer_id = v.id)::timestamptz, 'epoch'::timestamptz),
          COALESCE((SELECT MAX(rd.event_date) FROM event_role_assignments era
                    JOIN route_dates rd ON rd.id = era.route_date_id
                    WHERE era.volunteer_id = v.id)::timestamptz, 'epoch'::timestamptz)
        ) AS last_activity
      FROM volunteers v
    )
    SELECT id, full_name, email, is_guest, to_char(last_activity, 'YYYY-MM-DD') AS last_activity
    FROM activity
    WHERE last_activity < NOW() - INTERVAL '3 years'
    ORDER BY last_activity
  `;
}
