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
import { findInactiveVolunteers } from '../lib/volunteer-retention.js';

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

    const [routeRows, dateRows, streetRows, settingsRows, volunteerRows, assignmentRows, roleRows, inviteRows, flagRows, dateFlagRows] = await Promise.all([
      db.sql`SELECT id, name, display_order, internal_name FROM routes ORDER BY display_order NULLS LAST, name`,
      db.sql`SELECT id, route_id, to_char(event_date, 'YYYY-MM-DD') AS event_date, amount_collected, volunteer_capacity, what3words, notes, gathering_time, tracking_end_time, route_map_filename, route_map_content_type, route_track IS NOT NULL AS has_route_track, jsonb_array_length(route_track->'directions') AS route_track_turns, route_track->>'distanceKm' AS route_track_distance_km FROM route_dates ORDER BY event_date`,
      db.sql`SELECT id, route_date_id, sequence, name, time_range, is_partial FROM streets ORDER BY route_date_id, sequence`,
      db.sql`SELECT key, value FROM settings`,
      db.sql`SELECT id, email, full_name, phone, is_guest, reminder_email_opt_in, can_be_santa, can_be_safety_walker, can_be_driver, approval_status, registration_source, registered_at, reviewed_at, adult_confirmed_at, to_char(last_active_at, 'YYYY-MM-DD') AS last_active FROM volunteers ORDER BY COALESCE(full_name, email, '')`,
      db.sql`
        SELECT sa.id, sa.route_date_id, sa.volunteer_id, sa.role, sa.source,
               CASE WHEN COALESCE(TRIM(r.internal_name), '') <> '' THEN r.name || ' — ' || TRIM(r.internal_name) ELSE r.name END AS route_name, to_char(rd.event_date, 'YYYY-MM-DD') AS event_date
        FROM shift_assignments sa
        JOIN route_dates rd ON sa.route_date_id = rd.id
        JOIN routes r ON rd.route_id = r.id
        ORDER BY rd.event_date
      `,
      db.sql`SELECT route_date_id, role, volunteer_id FROM event_role_assignments`,
      // Branded invites not yet used (or cancelled) -- shown under the
      // Volunteers tab's invite form with Resend/Cancel.
      db.sql`SELECT id, email, full_name, created_at, expires_at, expires_at < NOW() AS expired FROM volunteer_invites WHERE used_at IS NULL AND cancelled_at IS NULL ORDER BY created_at DESC`,
      // Special-event flag types (admin-managed) and which nights have them.
      db.sql`SELECT id, emoji, label, description, style, display_order FROM event_flags ORDER BY display_order, id`,
      db.sql`SELECT route_date_id, flag_id FROM route_date_flags`
    ]);

    const flagIdsByDate = {};
    for (const f of dateFlagRows) {
      (flagIdsByDate[f.route_date_id] = flagIdsByDate[f.route_date_id] || []).push(f.flag_id);
    }
    const eventFlags = flagRows.map((f) => ({
      id: f.id, emoji: f.emoji || '', label: f.label, description: f.description || '',
      style: f.style, displayOrder: f.display_order
    }));

    const signupCountByDate = {};
    const signupsByDate = {};
    for (const a of assignmentRows) {
      signupCountByDate[a.route_date_id] = (signupCountByDate[a.route_date_id] || 0) + 1;
      (signupsByDate[a.route_date_id] = signupsByDate[a.route_date_id] || []).push({
        volunteerId: a.volunteer_id, role: a.role
      });
    }

    const rolesByDate = {};
    for (const r of roleRows) {
      (rolesByDate[r.route_date_id] = rolesByDate[r.route_date_id] || {})[r.role] = r.volunteer_id;
    }

    const streetsByDate = {};
    for (const s of streetRows) {
      (streetsByDate[s.route_date_id] = streetsByDate[s.route_date_id] || []).push({
        id: s.id, sequence: s.sequence, name: s.name, timeRange: s.time_range, isPartial: !!s.is_partial
      });
    }

    // Admins see full email addresses (already the existing behaviour on
    // the Volunteers page) -- this is just for labelling names on the
    // Events view's signup/role-assignment lists.
    const volunteerLabelById = {};
    for (const v of volunteerRows) {
      volunteerLabelById[v.id] = v.full_name || v.email || 'Guest volunteer';
    }

    const datesByRoute = {};
    for (const d of dateRows) {
      const roles = rolesByDate[d.id] || {};
      (datesByRoute[d.route_id] = datesByRoute[d.route_id] || []).push({
        id: d.id,
        eventDate: d.event_date,
        year: parseInt(d.event_date.slice(0, 4), 10),
        amountCollected: d.amount_collected != null ? Number(d.amount_collected) : null,
        volunteerCapacity: d.volunteer_capacity != null ? Number(d.volunteer_capacity) : null,
        signupCount: signupCountByDate[d.id] || 0,
        signups: (signupsByDate[d.id] || []).map((s) => ({
          volunteerId: s.volunteerId, role: s.role, name: volunteerLabelById[s.volunteerId] || 'Unknown'
        })),
        roleAssignments: {
          santa: roles.santa ? { volunteerId: roles.santa, name: volunteerLabelById[roles.santa] || 'Unknown' } : null,
          safetyWalker: roles.safety_walker ? { volunteerId: roles.safety_walker, name: volunteerLabelById[roles.safety_walker] || 'Unknown' } : null,
          driver: roles.driver ? { volunteerId: roles.driver, name: volunteerLabelById[roles.driver] || 'Unknown' } : null
        },
        what3words: d.what3words,
        notes: d.notes,
        gatheringTime: d.gathering_time,
        trackingEndTime: d.tracking_end_time,
        flagIds: flagIdsByDate[d.id] || [],
        routeMapFilename: d.route_map_filename,
        routeMapContentType: d.route_map_content_type,
        hasRouteTrack: !!d.has_route_track,
        routeTrackTurns: d.route_track_turns != null ? Number(d.route_track_turns) : null,
        routeTrackDistanceKm: d.route_track_distance_km != null ? Number(d.route_track_distance_km) : null,
        streets: streetsByDate[d.id] || []
      });
    }

    const years = Array.from(new Set(dateRows.map((d) => parseInt(d.event_date.slice(0, 4), 10)))).sort();

    const routes = routeRows.map((r) => ({
      id: r.id,
      name: r.name,
      internalName: r.internal_name || '',
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
        role: a.role,
        source: a.source
      });
    }

    // Self-registered volunteers awaiting review (or rejected) are kept out
    // of `volunteers` entirely, so they can't be picked for shifts/roles or
    // counted on the dashboard until approved.
    const toVolunteer = (v) => ({
      id: v.id,
      email: v.email,
      fullName: v.full_name,
      phone: v.phone,
      isGuest: !!v.is_guest,
      reminderEmailOptIn: v.reminder_email_opt_in,
      qualifiedRoles: {
        santa: !!v.can_be_santa,
        safetyWalker: !!v.can_be_safety_walker,
        driver: !!v.can_be_driver
      },
      shifts: assignmentsByVolunteer[v.id] || [],
      approvalStatus: v.approval_status,
      registrationSource: v.registration_source,
      registeredAt: v.registered_at,
      reviewedAt: v.reviewed_at,
      adultConfirmed: !!v.adult_confirmed_at,
      lastActive: v.last_active
    });
    const volunteers = volunteerRows.filter((v) => v.approval_status === 'approved').map(toVolunteer);
    const pendingVolunteers = volunteerRows.filter((v) => v.approval_status === 'pending').map(toVolunteer)
      .sort((a, b) => String(a.registeredAt || '').localeCompare(String(b.registeredAt || '')));
    const rejectedVolunteers = volunteerRows.filter((v) => v.approval_status === 'rejected').map(toVolunteer);

    const invites = inviteRows.map((i) => ({
      id: i.id, email: i.email, fullName: i.full_name, createdAt: i.created_at, expiresAt: i.expires_at, expired: !!i.expired
    }));

    // Privacy policy: no login/volunteering activity for 3 years -> flagged
    // here for manual review and deletion (see lib/volunteer-retention.js).
    const inactiveVolunteers = (await findInactiveVolunteers(db)).map((v) => ({
      id: v.id, fullName: v.full_name, email: v.email, isGuest: !!v.is_guest, lastActivity: v.last_activity
    }));

    return new Response(JSON.stringify({ routes, settings, eventFlags, volunteers, pendingVolunteers, rejectedVolunteers, invites, years, inactiveVolunteers }), { status: 200, headers });
  } catch (error) {
    console.error('Error fetching admin data:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
