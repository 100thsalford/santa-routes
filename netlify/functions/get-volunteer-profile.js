// Returns the logged-in volunteer's profile, creating a row for them on
// first access. Requires a valid Netlify Identity JWT in the Authorization
// header (sent automatically by netlify-identity-widget once logged in).
//
// `shifts` comes from shift_assignments, populated by the admin "Volunteer
// Shifts" screen (step 4) -- an empty array just means nothing's been
// assigned to this volunteer yet.

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { getVolunteerAccess } from '../lib/volunteer-access.js';

const headers = { 'Content-Type': 'application/json' };

export default async (req, context) => {
  try {
    const user = await getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Not logged in' }), { status: 401, headers });
    }

    const db = getDatabase();
    // Identity exposes a volunteer's chosen name at user_metadata.full_name
    // (set via the invite/signup flow) -- denormalized onto the volunteers
    // row so other functions (named shift-signup lists) can show a name
    // without needing the Identity Admin API.
    // (@netlify/identity normalises the user: the name is user.name /
    // user.userMetadata, not the raw user_metadata the widget exposes.)
    const fullName = user.name || (user.userMetadata && user.userMetadata.full_name) || null;

    // Self-registered and not yet approved (or rejected): return just
    // enough for the portal to show a "waiting for approval" message --
    // no shifts, settings or safety guidance.
    const access = await getVolunteerAccess(db, user);
    if (access.status !== 'approved') {
      const v = await db.sql`SELECT email, full_name FROM volunteers WHERE id = ${access.volunteerId}`;
      return new Response(JSON.stringify({
        approvalStatus: access.status,
        email: v.length ? v[0].email : user.email,
        fullName: v.length ? v[0].full_name : fullName,
        shifts: []
      }), { status: 200, headers });
    }

    let rows = await db.sql`
      SELECT id, identity_user_id, email, full_name, reminder_email_opt_in, preferred_email, risk_ack_at, adult_confirmed_at,
             can_be_santa, can_be_safety_walker, can_be_driver
      FROM volunteers WHERE identity_user_id = ${user.id}
    `;

    if (rows.length === 0) {
      rows = await db.sql`
        INSERT INTO volunteers (identity_user_id, email, full_name)
        VALUES (${user.id}, ${user.email}, ${fullName})
        ON CONFLICT (identity_user_id) DO UPDATE SET email = EXCLUDED.email, full_name = COALESCE(EXCLUDED.full_name, volunteers.full_name)
        RETURNING id, identity_user_id, email, full_name, reminder_email_opt_in, preferred_email, risk_ack_at, adult_confirmed_at,
                  can_be_santa, can_be_safety_walker, can_be_driver
      `;
    } else if (fullName && !rows[0].full_name) {
      // Keep the denormalized name fresh if Identity has one we didn't yet.
      rows = await db.sql`
        UPDATE volunteers SET full_name = ${fullName} WHERE id = ${rows[0].id}
        RETURNING id, identity_user_id, email, full_name, reminder_email_opt_in, preferred_email, risk_ack_at, adult_confirmed_at,
                  can_be_santa, can_be_safety_walker, can_be_driver
      `;
    }

    const profile = rows[0];

    // Activity for the 3-year inactivity rule (lib/volunteer-retention.js).
    // Throttled to one write a day per volunteer.
    await db.sql`
      UPDATE volunteers SET last_active_at = NOW()
      WHERE id = ${profile.id} AND (last_active_at IS NULL OR last_active_at < NOW() - INTERVAL '1 day')
    `;

    const settingsRows = await db.sql`
      SELECT key, value FROM settings
      WHERE key IN ('risk_assessment_text', 'risk_assessment_url', 'sightings_window_start', 'sightings_window_end')
    `;
    const settingsByKey = {};
    for (const row of settingsRows) settingsByKey[row.key] = row.value;

    const shiftRows = await db.sql`
      SELECT sa.route_date_id, sa.role, CASE WHEN COALESCE(TRIM(r.internal_name), '') <> '' THEN r.name || ' — ' || TRIM(r.internal_name) ELSE r.name END AS route_name, to_char(rd.event_date, 'YYYY-MM-DD') AS event_date,
             rd.what3words, rd.notes, rd.gathering_time, rd.route_map_filename, rd.route_track IS NOT NULL AS has_route_track
      FROM shift_assignments sa
      JOIN route_dates rd ON sa.route_date_id = rd.id
      JOIN routes r ON rd.route_id = r.id
      WHERE sa.volunteer_id = ${profile.id}
      ORDER BY rd.event_date
    `;

    // Special-event flags on this volunteer's nights.
    const flagRows = await db.sql`
      SELECT rdf.route_date_id, f.emoji, f.label, f.description, f.style
      FROM route_date_flags rdf
      JOIN event_flags f ON f.id = rdf.flag_id
      JOIN shift_assignments sa ON sa.route_date_id = rdf.route_date_id
      WHERE sa.volunteer_id = ${profile.id}
      ORDER BY f.display_order, f.id
    `;
    const flagsByDate = {};
    for (const f of flagRows) {
      (flagsByDate[f.route_date_id] = flagsByDate[f.route_date_id] || []).push({
        emoji: f.emoji || '', label: f.label, description: f.description || '', style: f.style
      });
    }

    const shifts = shiftRows.map((s) => ({
      routeDateId: s.route_date_id,
      routeName: s.route_name,
      eventDate: s.event_date,
      role: s.role,
      what3words: s.what3words,
      notes: s.notes,
      gatheringTime: s.gathering_time,
      hasRouteMap: !!s.route_map_filename,
      hasRouteTrack: !!s.has_route_track,
      flags: flagsByDate[s.route_date_id] || []
    }));

    return new Response(JSON.stringify({
      approvalStatus: 'approved',
      email: profile.email,
      fullName: profile.full_name,
      reminderEmailOptIn: profile.reminder_email_opt_in,
      preferredEmail: profile.preferred_email,
      riskAckAt: profile.risk_ack_at,
      adultConfirmedAt: profile.adult_confirmed_at,
      qualifiedRoles: {
        santa: !!profile.can_be_santa,
        safetyWalker: !!profile.can_be_safety_walker,
        driver: !!profile.can_be_driver
      },
      riskAssessment: {
        text: settingsByKey.risk_assessment_text || '',
        url: settingsByKey.risk_assessment_url || ''
      },
      // Same "route usually starts/ends at" proxy already used for the
      // 24h self-cancel cutoff (route_dates has no per-shift start time
      // of its own) -- reused here so "Add to calendar" has a start/end
      // time to put in the .ics file.
      sightingsWindowStart: settingsByKey.sightings_window_start || '17:00',
      sightingsWindowEnd: settingsByKey.sightings_window_end || '22:00',
      shifts
    }), { status: 200, headers });
  } catch (error) {
    console.error('Error fetching volunteer profile:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
