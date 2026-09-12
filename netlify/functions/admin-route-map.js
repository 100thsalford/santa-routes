// Admin upload/delete for a route_date's route map file (JPG/PNG/PDF),
// stored in Netlify Blobs rather than the DB -- route_dates only keeps a
// key/filename/content-type pointer (see the migration for why). Uploads
// arrive as multipart form data (routeDateId + file); deletes as a plain
// JSON { op: 'delete', routeDateId } POST -- kept as its own file rather
// than folded into admin-routes.js's op-dispatch since file handling
// doesn't fit that function's JSON-body shape.
//
// Requires a logged-in Identity user with the 'admin' role.

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { getStore } from '@netlify/blobs';

const headers = { 'Content-Type': 'application/json' };
const MAX_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf'
};

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

    const db = getDatabase();
    const store = getStore('route-maps');
    const contentType = req.headers.get('content-type') || '';

    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      const routeDateId = parseInt(form.get('routeDateId'), 10);
      const file = form.get('file');
      if (!routeDateId || !file || typeof file === 'string') {
        return new Response(JSON.stringify({ error: 'routeDateId and file are required' }), { status: 400, headers });
      }
      if (!ALLOWED_TYPES[file.type]) {
        return new Response(JSON.stringify({ error: 'Only JPG, PNG or PDF files are allowed' }), { status: 400, headers });
      }
      if (file.size > MAX_BYTES) {
        return new Response(JSON.stringify({ error: 'File is too large (10MB max)' }), { status: 400, headers });
      }

      const rows = await db.sql`SELECT route_map_key FROM route_dates WHERE id = ${routeDateId}`;
      if (rows.length === 0) {
        return new Response(JSON.stringify({ error: 'Date not found' }), { status: 404, headers });
      }
      const oldKey = rows[0].route_map_key;

      const key = 'route-maps/' + routeDateId + '-' + Date.now() + '.' + ALLOWED_TYPES[file.type];
      await store.set(key, await file.arrayBuffer());

      await db.sql`
        UPDATE route_dates
        SET route_map_key = ${key}, route_map_filename = ${file.name}, route_map_content_type = ${file.type}
        WHERE id = ${routeDateId}
      `;

      if (oldKey) {
        await store.delete(oldKey).catch((e) => console.error('Error deleting old route map blob:', e));
      }

      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

    // Plain JSON body -- only the delete op is supported here.
    const body = await req.json();
    if (body.op !== 'delete') {
      return new Response(JSON.stringify({ error: 'Unknown op' }), { status: 400, headers });
    }
    const routeDateId = parseInt(body.routeDateId, 10);
    if (!routeDateId) {
      return new Response(JSON.stringify({ error: 'routeDateId is required' }), { status: 400, headers });
    }

    const rows = await db.sql`SELECT route_map_key FROM route_dates WHERE id = ${routeDateId}`;
    if (rows.length > 0 && rows[0].route_map_key) {
      await store.delete(rows[0].route_map_key).catch((e) => console.error('Error deleting route map blob:', e));
    }

    await db.sql`
      UPDATE route_dates SET route_map_key = NULL, route_map_filename = NULL, route_map_content_type = NULL
      WHERE id = ${routeDateId}
    `;

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (error) {
    console.error('Error in admin-route-map:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
