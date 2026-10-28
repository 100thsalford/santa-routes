// Records a public "Santa sighting" report from index.html into the
// sightings table (previously a Google Form).
//
// Stored: the street (must be a real street from our route list), the time
// the visitor says they saw the sleigh, "Just Now"/"Earlier Today", and the
// submission time. Nothing that identifies the visitor is stored or logged.
// Reports are deleted after 30 days by purge-old-logs.js.

import { getDatabase } from '@netlify/database';
import { purgePublicCache, CACHE_TAGS } from '../lib/cdn-cache.js';

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers });
}

export default async (req) => {
  if (req.method !== 'POST') {
    return json({ success: false, error: 'Method not allowed' }, 405);
  }

  try {
    const data = await req.json();
    const street = String(data.street || '').trim().slice(0, 120);
    const time = String(data.time || '').trim();
    const when = data.when === 'Earlier Today' ? 'Earlier Today' : 'Just Now';

    if (!street || !/^\d{1,2}:\d{2}$/.test(time)) {
      return json({ success: false, error: 'Street and time are required' }, 400);
    }

    const db = getDatabase();
    const known = await db.sql`SELECT 1 FROM streets WHERE name = ${street} LIMIT 1`;
    if (known.length === 0) {
      return json({ success: false, error: 'Please select a street from the list' }, 400);
    }

    await db.sql`
      INSERT INTO sightings (street, seen_time, seen_when)
      VALUES (${street}, ${time}, ${when})
    `;

    // get-sightings is CDN-cached; clear it before replying so the list the
    // page reloads straight after this includes the new report.
    await purgePublicCache([CACHE_TAGS.sightings]);

    return json({ success: true, message: 'Thank you! Santa sighting recorded.' });
  } catch (error) {
    console.error('Error submitting sighting:', error.message);
    return json({ success: false, error: 'Failed to submit sighting' }, 500);
  }
};
