// Admin CRUD for routes / route_dates / streets. One op-dispatched endpoint
// rather than several REST-y ones -- keeps this manageable for a small
// admin surface. The client just re-fetches admin-data.js after each write
// rather than trying to patch its own local copy, to avoid drift.
//
// Requires a logged-in Identity user with the 'admin' role.

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';

const headers = { 'Content-Type': 'application/json' };

function requireAdmin(user) {
  return !!(user && user.roles && user.roles.includes('admin'));
}

export default async (req, context) => {
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
        const rows = await db.sql`
          INSERT INTO routes (name, display_order) VALUES (${name}, ${displayOrder})
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
        const rows = await db.sql`
          INSERT INTO route_dates (route_id, event_date) VALUES (${routeId}, ${eventDate})
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

      case 'create-street': {
        const routeDateId = parseInt(body.routeDateId, 10);
        const name = String(body.name || '').trim();
        if (!routeDateId || !name) return badRequest('routeDateId and name are required');
        const sequence = body.sequence != null ? parseInt(body.sequence, 10) : 0;
        const timeRange = body.timeRange != null ? String(body.timeRange).trim() : null;
        const rows = await db.sql`
          INSERT INTO streets (route_date_id, sequence, name, time_range)
          VALUES (${routeDateId}, ${sequence}, ${name}, ${timeRange})
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
        await db.sql`
          UPDATE streets SET name = ${name}, sequence = ${sequence}, time_range = ${timeRange}
          WHERE id = ${id}
        `;
        return ok();
      }

      case 'delete-street': {
        const id = parseInt(body.id, 10);
        if (!id) return badRequest('Street id is required');
        await db.sql`DELETE FROM streets WHERE id = ${id}`;
        return ok();
      }

      default:
        return badRequest('Unknown op: ' + body.op);
    }
  } catch (error) {
    console.error('Error in admin-routes:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};

function ok(extra) {
  return new Response(JSON.stringify(Object.assign({ success: true }, extra)), { status: 200, headers });
}

function badRequest(message) {
  return new Response(JSON.stringify({ error: message }), { status: 400, headers });
}
