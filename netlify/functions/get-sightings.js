// Latest Santa sightings for index.html: up to 5 reports from the last 6
// hours, newest first. Reads the sightings table (see submit-sighting.js);
// the table itself only ever holds the last 30 days (purge-old-logs.js).
//
// `timestamp` keeps the old Google Forms shape ("DD/MM/YYYY HH:MM:SS", UK
// local time) because script.js's formatSightingTime parses that format.

import { getDatabase } from '@netlify/database';
import { cdnCacheHeaders, CACHE_TAGS } from '../lib/cdn-cache.js';

const headers = { 'Content-Type': 'application/json' };

// Loaded on every home page view during the sightings window. Cached for
// 30s at the CDN; submit-sighting.js purges it before replying, so the
// person who just reported a sighting still sees it in the list at once.
const cacheHeaders = cdnCacheHeaders({ maxAge: 30, tags: [CACHE_TAGS.sightings] });

export default async () => {
  try {
    const db = getDatabase();
    const rows = await db.sql`
      SELECT street, seen_time, seen_when,
             to_char(created_at AT TIME ZONE 'Europe/London', 'DD/MM/YYYY HH24:MI:SS') AS ts
      FROM sightings
      WHERE created_at > NOW() - INTERVAL '6 hours'
      ORDER BY created_at DESC
      LIMIT 5
    `;
    const sightings = rows.map((r) => ({
      street: r.street,
      time: r.seen_time,
      when: r.seen_when,
      timestamp: r.ts
    }));
    return new Response(JSON.stringify({ success: true, sightings }), { status: 200, headers: { ...headers, ...cacheHeaders } });
  } catch (error) {
    console.error('Error fetching sightings:', error.message);
    return new Response(JSON.stringify({ success: true, sightings: [] }), { status: 200, headers: { ...headers, 'Cache-Control': 'no-store' } });
  }
};
