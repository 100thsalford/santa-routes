// Netlify Function (v2, fetch-style) to fetch routes from the Netlify DB (Postgres).
// Replaces the old Google Sheet CSV fetch. Response shape is kept identical to the
// old function so the front-end doesn't need to change:
// { success, routes: [{ street, date, route, time }], lastUpdated, debug }
//
// This must use the v2 (fetch-style: `export default async (req, context) => ...`)
// function signature rather than the old Lambda-compatible `exports.handler` form —
// Netlify only auto-injects the Netlify DB connection string for v2 functions.
// See https://ntl.fyi/database-environment

import { getDatabase } from '@netlify/database';

const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json'
};

export default async (req, context) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 200, headers });
  }

  try {
    const db = getDatabase();

    const rows = await db.sql`
      SELECT
        r.name AS route,
        to_char(rd.event_date, 'YYYY-MM-DD') AS date,
        s.name AS street,
        s.time_range AS time
      FROM streets s
      JOIN route_dates rd ON s.route_date_id = rd.id
      JOIN routes r ON rd.route_id = r.id
      ORDER BY rd.event_date, r.display_order NULLS LAST, r.name, s.sequence
    `;

    console.log('Rows fetched from DB:', rows.length);

    return new Response(
      JSON.stringify({
        success: true,
        routes: rows,
        lastUpdated: new Date().toISOString(),
        debug: {
          totalRoutes: rows.length,
          sampleRoute: rows[0] || null,
          source: 'netlify-db'
        }
      }),
      { status: 200, headers }
    );

  } catch (error) {
    console.error('Error fetching routes from DB:', error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
        routes: [],
        debug: {
          errorType: error.name,
          errorMessage: error.message,
          source: 'netlify-db'
        }
      }),
      { status: 200, headers }
    );
  }
};
