// Admin CRUD for routes / route_dates / streets. One op-dispatched endpoint
// rather than several REST-y ones -- keeps this manageable for a small
// admin surface. The client just re-fetches admin-data.js after each write
// rather than trying to patch its own local copy, to avoid drift.
//
// Requires a logged-in Identity user with the 'admin' role.

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { purgePublicCache, CACHE_TAGS } from '../lib/cdn-cache.js';

const headers = { 'Content-Type': 'application/json' };

function requireAdmin(user) {
  return !!(user && user.roles && user.roles.includes('admin'));
}

// Route, date and street edits feed get-routes / get-public-routes, the
// season dates and Total Raised in get-site-status, and tonight's route in
// get-tracking-data -- clear their CDN copies after every successful write.
export default async (req, context) => {
  const res = await handle(req, context);
  if (res.status === 200) {
    await purgePublicCache([CACHE_TAGS.routes, CACHE_TAGS.siteStatus, CACHE_TAGS.tracking], { retry: true });
  }
  return res;
};

async function handle(req, context) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const user = await getUser();
    if (!requireAdmin(user)) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers });
    }

    const body = await req.json();
    const db = getDatabase();

    switch (body.op) {
      case 'create-route': {
        const name = String(body.name || '').trim();
        if (!name) return badRequest('Route name is required');
        const displayOrder = body.displayOrder != null ? parseInt(body.displayOrder, 10) : null;
        const internalName = String(body.internalName || '').trim().slice(0, 200) || null;
        const rows = await db.sql`
          INSERT INTO routes (name, display_order, internal_name) VALUES (${name}, ${displayOrder}, ${internalName})
          RETURNING id
        `;
        return ok({ id: rows[0].id });
      }

      case 'update-route': {
        const id = parseInt(body.id, 10);
        const name = String(body.name || '').trim();
        if (!id || !name) return badRequest('Route id and name are required');
        const displayOrder = body.displayOrder != null ? parseInt(body.displayOrder, 10) : null;
        await db.sql`
          UPDATE routes SET name = ${name}, display_order = ${displayOrder} WHERE id = ${id}
        `;
        return ok();
      }

      // Volunteer-only internal name (routes.internal_name), saved from the
      // box in each route's header in admin.html. Blank clears it.
      case 'set-route-internal-name': {
        const id = parseInt(body.id, 10);
        if (!id) return badRequest('Route id is required');
        const internalName = String(body.internalName || '').trim().slice(0, 200) || null;
        await db.sql`UPDATE routes SET internal_name = ${internalName} WHERE id = ${id}`;
        return ok();
      }

      case 'delete-route': {
        const id = parseInt(body.id, 10);
        if (!id) return badRequest('Route id is required');
        await db.sql`DELETE FROM routes WHERE id = ${id}`;
        return ok();
      }

      case 'create-date': {
        const routeId = parseInt(body.routeId, 10);
        const eventDate = String(body.eventDate || '').trim();
        if (!routeId || !eventDate) return badRequest('routeId and eventDate are required');
        const volunteerCapacity = body.volunteerCapacity != null && String(body.volunteerCapacity).trim() !== ''
          ? parseInt(body.volunteerCapacity, 10)
          : null;
        const rows = await db.sql`
          INSERT INTO route_dates (route_id, event_date, volunteer_capacity) VALUES (${routeId}, ${eventDate}, ${volunteerCapacity})
          RETURNING id
        `;
        return ok({ id: rows[0].id });
      }

      case 'delete-date': {
        const id = parseInt(body.id, 10);
        if (!id) return badRequest('Date id is required');
        await db.sql`DELETE FROM route_dates WHERE id = ${id}`;
        return ok();
      }

      case 'update-date': {
        const id = parseInt(body.id, 10);
        const eventDate = String(body.eventDate || '').trim();
        if (!id || !eventDate) return badRequest('Date id and eventDate are required');
        const amountCollected = body.amountCollected != null && String(body.amountCollected).trim() !== ''
          ? Number(body.amountCollected)
          : null;
        const volunteerCapacity = body.volunteerCapacity != null && String(body.volunteerCapacity).trim() !== ''
          ? parseInt(body.volunteerCapacity, 10)
          : null;
        const what3words = body.what3words != null && String(body.what3words).trim() !== ''
          ? String(body.what3words).trim().replace(/^\/+/, '')
          : null;
        const notes = body.notes != null && String(body.notes).trim() !== '' ? String(body.notes).trim() : null;
        const gatheringTime = body.gatheringTime != null && String(body.gatheringTime).trim() !== ''
          ? String(body.gatheringTime).trim()
          : null;
        // Optional per-night live-tracking cut-off ("HH:MM"); blank = season default.
        const trackingEndTime = body.trackingEndTime != null && String(body.trackingEndTime).trim() !== ''
          ? String(body.trackingEndTime).trim()
          : null;
        if (trackingEndTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(trackingEndTime)) {
          return badRequest('Tracking end time must be a 24hr time like 21:30');
        }
        await db.sql`
          UPDATE route_dates
          SET event_date = ${eventDate}, amount_collected = ${amountCollected}, volunteer_capacity = ${volunteerCapacity},
              what3words = ${what3words}, notes = ${notes}, gathering_time = ${gatheringTime},
              tracking_end_time = ${trackingEndTime}
          WHERE id = ${id}
        `;
        return ok();
      }

      // Copies a route_date's full street list (name/sequence/time range)
      // into a brand new route_date on the same route, so a new season's
      // night can start from last year's list instead of being retyped.
      // The new date's amount_collected is intentionally left null -- it's
      // a new night's collection, not a copy of last year's total.
      case 'clone-date': {
        const sourceDateId = parseInt(body.sourceDateId, 10);
        const newEventDate = String(body.newEventDate || '').trim();
        if (!sourceDateId || !newEventDate) return badRequest('sourceDateId and newEventDate are required');

        const sourceRows = await db.sql`SELECT route_id FROM route_dates WHERE id = ${sourceDateId}`;
        if (sourceRows.length === 0) return badRequest('Source date not found');
        const routeId = sourceRows[0].route_id;

        const newDateRows = await db.sql`
          INSERT INTO route_dates (route_id, event_date) VALUES (${routeId}, ${newEventDate})
          RETURNING id
        `;
        const newDateId = newDateRows[0].id;

        const sourceStreets = await db.sql`
          SELECT sequence, name, time_range, is_partial FROM streets WHERE route_date_id = ${sourceDateId} ORDER BY sequence
        `;
        for (const s of sourceStreets) {
          await db.sql`
            INSERT INTO streets (route_date_id, sequence, name, time_range, is_partial)
            VALUES (${newDateId}, ${s.sequence}, ${s.name}, ${s.time_range}, ${!!s.is_partial})
          `;
        }

        return ok({ id: newDateId, streetsCopied: sourceStreets.length });
      }

      case 'create-street': {
        const routeDateId = parseInt(body.routeDateId, 10);
        const name = String(body.name || '').trim();
        if (!routeDateId || !name) return badRequest('routeDateId and name are required');
        const sequence = body.sequence != null ? parseInt(body.sequence, 10) : 0;
        const timeRange = body.timeRange != null ? String(body.timeRange).trim() : null;
        const isPartial = body.isPartial === true;
        const rows = await db.sql`
          INSERT INTO streets (route_date_id, sequence, name, time_range, is_partial)
          VALUES (${routeDateId}, ${sequence}, ${name}, ${timeRange}, ${isPartial})
          RETURNING id
        `;
        return ok({ id: rows[0].id });
      }

      case 'update-street': {
        const id = parseInt(body.id, 10);
        const name = String(body.name || '').trim();
        if (!id || !name) return badRequest('Street id and name are required');
        const sequence = body.sequence != null ? parseInt(body.sequence, 10) : 0;
        const timeRange = body.timeRange != null ? String(body.timeRange).trim() : null;
        if (typeof body.isPartial === 'boolean') {
          await db.sql`
            UPDATE streets SET name = ${name}, sequence = ${sequence}, time_range = ${timeRange}, is_partial = ${body.isPartial}
            WHERE id = ${id}
          `;
        } else {
          await db.sql`
            UPDATE streets SET name = ${name}, sequence = ${sequence}, time_range = ${timeRange}
            WHERE id = ${id}
          `;
        }
        return ok();
      }

      // Bulk save from the per-night "Save street changes" button in
      // admin.html -- every edited row (seq/name/time) for one route_date
      // in a single statement, scoped to that route_date.
      case 'update-streets': {
        const routeDateId = parseInt(body.routeDateId, 10);
        if (!routeDateId) return badRequest('routeDateId is required');
        if (!Array.isArray(body.streets) || body.streets.length === 0 || body.streets.length > 400) {
          return badRequest('streets must be an array of 1-400 entries');
        }
        const rows = [];
        for (const raw of body.streets) {
          const id = parseInt(raw && raw.id, 10);
          const name = String((raw && raw.name) || '').trim().slice(0, 200);
          if (!id || !name) return badRequest('Each street needs an id and a name');
          const seq = parseInt(raw.sequence, 10);
          const timeRange = raw.timeRange != null ? String(raw.timeRange).trim().slice(0, 100) : '';
          rows.push({ id, seq: Number.isFinite(seq) ? seq : 0, name, time_range: timeRange || null, is_partial: raw.isPartial === true });
        }
        const updated = await db.sql`
          UPDATE streets AS s
          SET sequence = u.seq, name = u.name, time_range = u.time_range, is_partial = u.is_partial
          FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS u(id int, seq int, name text, time_range text, is_partial boolean)
          WHERE s.id = u.id AND s.route_date_id = ${routeDateId}
          RETURNING s.id
        `;
        return ok({ streetsUpdated: updated.length });
      }

      case 'delete-street': {
        const id = parseInt(body.id, 10);
        if (!id) return badRequest('Street id is required');
        await db.sql`DELETE FROM streets WHERE id = ${id}`;
        return ok();
      }

      // Bulk save from the "Import streets from route" preview in
      // admin.html (street names derived client-side from a date's stored
      // GPX route_track + OpenStreetMap). One statement -- a data-modifying
      // CTE -- so a 'replace' import can never leave a night half-deleted.
      // Times are intentionally left blank for the admin to fill in.
      //
      // Each street may carry the lat/lng it was matched at on the route;
      // those seed street_geocodes (see admin-geocode-streets.js) so the
      // nearest-covered-street search doesn't need a Nominatim lookup for
      // them. Existing geocodes are left alone (ON CONFLICT DO NOTHING).
      case 'import-streets': {
        const routeDateId = parseInt(body.routeDateId, 10);
        const replace = body.mode === 'replace';
        if (!routeDateId) return badRequest('routeDateId is required');
        if (!Array.isArray(body.streets) || body.streets.length === 0 || body.streets.length > 400) {
          return badRequest('streets must be an array of 1-400 entries');
        }

        const dateRows = await db.sql`SELECT id FROM route_dates WHERE id = ${routeDateId}`;
        if (dateRows.length === 0) return badRequest('Date not found');

        let startSeq = 1;
        if (!replace) {
          const maxRows = await db.sql`SELECT COALESCE(MAX(sequence), 0) AS max_seq FROM streets WHERE route_date_id = ${routeDateId}`;
          startSeq = Number(maxRows[0].max_seq) + 1;
        }

        const rows = [];
        const geocodes = new Map();
        for (const raw of body.streets) {
          const name = String((raw && raw.name) || '').trim().slice(0, 200);
          if (!name) continue;
          rows.push({ seq: startSeq + rows.length, name });
          const lat = Number(raw.lat), lng = Number(raw.lng);
          const key = cleanStreetKey(name);
          if (key && Number.isFinite(lat) && Number.isFinite(lng) && !geocodes.has(key)) {
            geocodes.set(key, { key, lat, lng });
          }
        }
        if (rows.length === 0) return badRequest('No street names to save');

        await db.sql`
          WITH removed AS (
            DELETE FROM streets WHERE route_date_id = ${routeDateId} AND ${replace}
          )
          INSERT INTO streets (route_date_id, sequence, name, time_range)
          SELECT ${routeDateId}, s.seq, s.name, NULL
          FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS s(seq int, name text)
        `;

        if (geocodes.size > 0) {
          await db.sql`
            INSERT INTO street_geocodes (street_name, lat, lng, source)
            SELECT g.key, g.lat, g.lng, 'osm-route'
            FROM jsonb_to_recordset(${JSON.stringify(Array.from(geocodes.values()))}::jsonb) AS g(key text, lat float8, lng float8)
            ON CONFLICT (street_name) DO NOTHING
          `;
        }

        return ok({ streetsSaved: rows.length, replaced: replace });
      }

      // Sets (or clears, when volunteerId is null/absent) who's playing
      // Santa/Safety Walker/Driver for one route_date. Kept in its own
      // event_role_assignments table rather than shift_assignments -- these
      // slots don't count toward that date's volunteer-capacity total
      // (matches the Replit reference app: a date can show "0/8 volunteers"
      // while still having a Santa assigned).
      case 'set-event-role': {
        const routeDateId = parseInt(body.routeDateId, 10);
        const role = String(body.role || '');
        if (!routeDateId || !['santa', 'safety_walker', 'driver'].includes(role)) {
          return badRequest('routeDateId and a valid role (santa/safety_walker/driver) are required');
        }
        const volunteerId = body.volunteerId != null && String(body.volunteerId).trim() !== ''
          ? parseInt(body.volunteerId, 10)
          : null;
        await db.sql`
          INSERT INTO event_role_assignments (route_date_id, role, volunteer_id)
          VALUES (${routeDateId}, ${role}, ${volunteerId})
          ON CONFLICT (route_date_id, role) DO UPDATE SET volunteer_id = EXCLUDED.volunteer_id
        `;
        return ok();
      }

      // ---- Special-event flags ----
      // Toggled per night from the chips under each date in admin.html.
      // Sets the night's whole flag set: drops any not in the list, adds
      // any missing (unknown flag ids are ignored).
      case 'set-date-flags': {
        const routeDateId = parseInt(body.routeDateId, 10);
        if (!routeDateId) return badRequest('routeDateId is required');
        if (!Array.isArray(body.flagIds) || body.flagIds.length > 50) return badRequest('flagIds must be an array');
        const flagIds = Array.from(new Set(body.flagIds.map((x) => parseInt(x, 10)).filter((x) => x > 0)));
        const idsJson = JSON.stringify(flagIds);
        await db.sql`
          DELETE FROM route_date_flags
          WHERE route_date_id = ${routeDateId}
            AND flag_id NOT IN (SELECT value::int FROM jsonb_array_elements_text(${idsJson}::jsonb))
        `;
        await db.sql`
          INSERT INTO route_date_flags (route_date_id, flag_id)
          SELECT ${routeDateId}, f.id FROM event_flags f
          WHERE f.id IN (SELECT value::int FROM jsonb_array_elements_text(${idsJson}::jsonb))
          ON CONFLICT DO NOTHING
        `;
        return ok();
      }

      // Admin-managed flag types (emoji, short chip label, longer
      // description, colour style), edited in the Routes & Streets tab.
      case 'create-flag':
      case 'update-flag': {
        const fields = parseFlagFields(body);
        if (fields.error) return badRequest(fields.error);
        const { emoji, label, description, style, displayOrder } = fields;
        if (body.op === 'create-flag') {
          const rows = await db.sql`
            INSERT INTO event_flags (emoji, label, description, style, display_order)
            VALUES (${emoji}, ${label}, ${description}, ${style},
                    COALESCE(${displayOrder}::int, (SELECT COALESCE(MAX(display_order), 0) + 1 FROM event_flags)))
            RETURNING id
          `;
          return ok({ id: rows[0].id });
        }
        const id = parseInt(body.id, 10);
        if (!id) return badRequest('Flag id is required');
        await db.sql`
          UPDATE event_flags
          SET emoji = ${emoji}, label = ${label}, description = ${description}, style = ${style},
              display_order = COALESCE(${displayOrder}::int, display_order)
          WHERE id = ${id}
        `;
        return ok();
      }

      // Removes the flag type and (via ON DELETE CASCADE) it from every night.
      case 'delete-flag': {
        const id = parseInt(body.id, 10);
        if (!id) return badRequest('Flag id is required');
        await db.sql`DELETE FROM event_flags WHERE id = ${id}`;
        return ok();
      }

      default:
        return badRequest('Unknown op: ' + body.op);
    }
  } catch (error) {
    console.error('Error in admin-routes:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}

function ok(extra) {
  return new Response(JSON.stringify(Object.assign({ success: true }, extra)), { status: 200, headers });
}

// Same normalisation as cleanStreetName() in admin-geocode-streets.js
// (strip leading sequence numbers and "(Partial)"-style notes, collapse
// whitespace, lowercase) so seeded geocodes match the keys it looks up.
function cleanStreetKey(raw) {
  let name = (raw || '').replace(/^\d+[.\-]\s*/, '');
  name = name.replace(/\s*\([^)]*\)/g, '');
  return name.replace(/\s+/g, ' ').trim().toLowerCase();
}

const FLAG_STYLES = ['neutral', 'amber', 'city', 'united'];

function parseFlagFields(body) {
  const label = String(body.label || '').trim().slice(0, 30);
  if (!label) return { error: 'A short label is required (e.g. "8pm")' };
  const emoji = String(body.emoji || '').trim().slice(0, 16) || null;
  const description = String(body.description || '').trim().slice(0, 200) || null;
  const style = FLAG_STYLES.includes(body.style) ? body.style : 'neutral';
  const order = body.displayOrder != null && String(body.displayOrder).trim() !== '' ? parseInt(body.displayOrder, 10) : null;
  return { emoji, label, description, style, displayOrder: Number.isFinite(order) ? order : null };
}

function badRequest(message) {
  return new Response(JSON.stringify({ error: message }), { status: 400, headers });
}
