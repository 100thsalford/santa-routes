// Streams a route_date's route map file (JPG/PNG/PDF) from Netlify Blobs.
// Requires a logged-in Identity user (any volunteer or admin, not just
// admins) -- route maps carry a "don't share outside the volunteer group"
// warning in the UI, so this isn't a public/anonymous endpoint the way
// get-shift-openings.js is.

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { getStore } from '@netlify/blobs';

const jsonHeaders = { 'Content-Type': 'application/json' };

export default async (req, context) => {
  try {
    const user = await getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Not logged in' }), { status: 401, headers: jsonHeaders });
    }

    const url = new URL(req.url);
    const routeDateId = parseInt(url.searchParams.get('routeDateId'), 10);
    if (!routeDateId) {
      return new Response(JSON.stringify({ error: 'routeDateId is required' }), { status: 400, headers: jsonHeaders });
    }

    const db = getDatabase();
    const rows = await db.sql`
      SELECT route_map_key, route_map_filename, route_map_content_type
      FROM route_dates WHERE id = ${routeDateId}
    `;
    if (rows.length === 0 || !rows[0].route_map_key) {
      return new Response(JSON.stringify({ error: 'No route map for this date' }), { status: 404, headers: jsonHeaders });
    }

    const key = rows[0].route_map_key;
    const filename = rows[0].route_map_filename;
    const contentType = rows[0].route_map_content_type;

    const store = getStore('route-maps');
    const data = await store.get(key, { type: 'arrayBuffer' });
    if (!data) {
      return new Response(JSON.stringify({ error: 'Route map file is missing' }), { status: 404, headers: jsonHeaders });
    }

    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': contentType || 'application/octet-stream',
        'Content-Disposition': 'inline; filename="' + (filename || 'route-map') + '"',
        'Cache-Control': 'private, max-age=300'
      }
    });
  } catch (error) {
    console.error('Error fetching route map:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: jsonHeaders });
  }
};
