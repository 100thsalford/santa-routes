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
import { getVolunteerAccess } from '../lib/volunteer-access.js';

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

    // A logged-in volunteer still awaiting approval (or rejected) is
    // treated exactly like an anonymous visitor: no names.
    let user = await getUser();
    let volunteerId = null;
    if (user) {
      const access = await getVolunteerAccess(db, user);
      if (access.status === 'approved') volunteerId = access.volunteerId;
      else user = null;
    }

    const rows = await db.sql`
      SELECT
        rd.id, CASE WHEN COALESCE(TRIM(r.internal_name), '') <> '' THEN r.name || ' — ' || TRIM(r.internal_name) ELSE r.name END AS route_name, to_char(rd.event_date, 'YYYY-MM-DD') AS event_date,
        rd.volunteer_capacity, rd.what3words, rd.notes, rd.gathering_time, rd.route_map_filename,
        rd.route_track IS NOT NULL AS has_route_track,
        COUNT(sa.id) AS signup_count,
        BOOL_OR(sa.volunteer_id = ${volunteerId}) AS viewer_signed_up
      FROM route_dates rd
      JOIN routes r ON rd.route_id = r.id
      LEFT JOIN shift_assignments sa ON sa.route_date_id = rd.id
      WHERE rd.event_date >= ${todayDate}
      GROUP BY rd.id, r.name, r.internal_name, rd.event_date, rd.volunteer_capacity, rd.what3words, rd.notes, rd.gathering_time, rd.route_map_filename, rd.route_track, r.display_order
      ORDER BY rd.event_date, r.display_order NULLS LAST, r.name
    `;

    // Who's signed up, by name -- shown to any logged-in volunteer (Phase 9
    // decision, superseding the earlier aggregate-count-only privacy call),
    // but never to a fully anonymous request, since this endpoint doesn't
    // itself require a login. Uses the denormalized volunteers.full_name
    // (or just "Volunteer" if no name is on file) rather than any part of an email
    // address, matching Replit's name-only display without handing every
    // volunteer's email to every other volunteer.
    let signupsByDate = {};
    if (user) {
      const signupRows = await db.sql`
        SELECT sa.route_date_id, v.full_name
        FROM shift_assignments sa
        JOIN volunteers v ON v.id = sa.volunteer_id
        WHERE sa.route_date_id IN (SELECT id FROM route_dates WHERE event_date >= ${todayDate})
      `;
      for (const s of signupRows) {
        // Never derive a name from an email address (privacy policy:
        // volunteers see names only, not contact details).
        const name = s.full_name || 'Volunteer';
        (signupsByDate[s.route_date_id] = signupsByDate[s.route_date_id] || []).push(name);
      }
    }

    const roleRows = await db.sql`
      SELECT era.route_date_id, era.role, era.volunteer_id, v.full_name
      FROM event_role_assignments era
      LEFT JOIN volunteers v ON v.id = era.volunteer_id
      WHERE era.route_date_id IN (SELECT id FROM route_dates WHERE event_date >= ${todayDate})
    `;
    const rolesByDate = {};
    for (const r of roleRows) {
      if (!r.volunteer_id) continue;
      (rolesByDate[r.route_date_id] = rolesByDate[r.route_date_id] || {})[r.role] =
        r.full_name || 'Volunteer';
    }

    // Special-event flags (e.g. "⏳ Long", "⚽ 8pm — City Home 8pm") --
    // only sent to logged-in volunteers (volunteer portal only, not public).
    const flagsByDate = {};
    if (user) {
      const flagRows = await db.sql`
        SELECT rdf.route_date_id, f.emoji, f.label, f.description, f.style
        FROM route_date_flags rdf
        JOIN event_flags f ON f.id = rdf.flag_id
        WHERE rdf.route_date_id IN (SELECT id FROM route_dates WHERE event_date >= ${todayDate})
        ORDER BY f.display_order, f.id
      `;
      for (const f of flagRows) {
        (flagsByDate[f.route_date_id] = flagsByDate[f.route_date_id] || []).push({
          emoji: f.emoji || '', label: f.label, description: f.description || '', style: f.style
        });
      }
    }

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
        // Meeting point, notes (which can hold key contacts) and every name
        // are for approved, logged-in volunteers only -- an anonymous or
        // unapproved request gets dates and capacity, nothing personal.
        what3words: user ? r.what3words : null,
        notes: user ? r.notes : null,
        gatheringTime: user ? r.gathering_time : null,
        hasRouteMap: !!r.route_map_filename,
        hasRouteTrack: !!r.has_route_track,
        signupNames: signupsByDate[r.id] || null,
        roles: user ? (rolesByDate[r.id] || null) : null,
        flags: flagsByDate[r.id] || []
      };
    });

    return new Response(JSON.stringify({ shifts }), { status: 200, headers });
  } catch (error) {
    console.error('Error fetching shift openings:', error);
    return new Response(JSON.stringify({ error: error.message, shifts: [] }), { status: 200, headers });
  }
};
