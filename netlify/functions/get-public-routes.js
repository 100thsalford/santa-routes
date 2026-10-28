// Public route lines for map.html ("Interactive Map"): one entry per
// night of the current season that has an uploaded GPX route_track.
//
// Deliberately exposes ONLY the line, route name and date. The
// turn-by-turn directions (and any volunteer notes in them, e.g.
// "HOLD ...") stay login-gated in get-route-track.js.
//
// "Current season" = the latest year that has any route_dates, matching
// get-site-status.js's Total Raised logic. Lines are simplified
// (Douglas-Peucker, ~4m) and rounded to 5dp (~1m) to keep the payload
// small for mobile.

import { getDatabase } from '@netlify/database';
import { cdnCacheHeaders, CACHE_TAGS } from '../lib/cdn-cache.js';

// Browsers keep a copy for 5 minutes (as before); the CDN keeps one
// durable copy for 10, purged whenever an admin changes a route or its
// GPX track (admin-routes.js / admin-route-track.js).
const headers = {
  'Content-Type': 'application/json',
  ...cdnCacheHeaders({ maxAge: 600, tags: [CACHE_TAGS.routes] }),
  'Cache-Control': 'public, max-age=300'
};

const SIMPLIFY_METRES = 4;

function simplify(points, tolMetres) {
  if (points.length <= 2) return points;
  const lat0 = points[0][0] * Math.PI / 180;
  const kx = 111320 * Math.cos(lat0), ky = 110540;
  const xy = points.map((p) => [p[1] * kx, p[0] * ky]);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = xy[a], [bx, by] = xy[b];
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    let maxD = 0, idx = -1;
    for (let i = a + 1; i < b; i++) {
      let t = len2 ? ((xy[i][0] - ax) * dx + (xy[i][1] - ay) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const d = Math.hypot(ax + t * dx - xy[i][0], ay + t * dy - xy[i][1]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tolMetres && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

export default async () => {
  try {
    const db = getDatabase();
    const rows = await db.sql`
      SELECT rd.id, r.name AS route_name, r.display_order,
             to_char(rd.event_date, 'YYYY-MM-DD') AS date,
             rd.route_track->'points' AS points,
             rd.route_track->>'distanceKm' AS distance_km
      FROM route_dates rd
      JOIN routes r ON r.id = rd.route_id
      WHERE rd.route_track IS NOT NULL
        AND EXTRACT(YEAR FROM rd.event_date) = (SELECT MAX(EXTRACT(YEAR FROM event_date)) FROM route_dates)
      ORDER BY rd.event_date, r.display_order NULLS LAST, r.name
    `;

    const nights = rows
      .map((r) => Object.assign(r, { points: typeof r.points === 'string' ? JSON.parse(r.points) : r.points }))
      .filter((r) => Array.isArray(r.points) && r.points.length >= 2)
      .map((r) => ({
        id: r.id,
        route: r.route_name,
        date: r.date,
        distanceKm: r.distance_km != null ? Math.round(Number(r.distance_km) * 10) / 10 : null,
        points: simplify(r.points, SIMPLIFY_METRES).map((p) => [
          Math.round(p[0] * 1e5) / 1e5,
          Math.round(p[1] * 1e5) / 1e5
        ])
      }));

    return new Response(JSON.stringify({ nights }), { status: 200, headers });
  } catch (error) {
    console.error('Error fetching public routes:', error);
    return new Response(JSON.stringify({ error: 'Could not load routes', nights: [] }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
    });
  }
};
