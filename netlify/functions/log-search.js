// Logs a street search from index.html's "When is Santa visiting?" search
// box into the search_logs table, so we can see which streets people look
// for and which ones we don't cover.
//
// Privacy by design: this stores NO IP address, user agent, referrer or
// location. The typed text is minimised before it is saved (house numbers,
// postcodes and anything that looks like an email are removed), and rows are
// deleted automatically by purge-old-logs.js (unmatched searches after 90
// days, the rest after 13 months). The ip/user_agent/referer/country/city/
// region columns are kept in the table only so older deploys keep working;
// they are always written as NULL.
//
// Fire-and-forget from the client (analytics.js), so failures here should
// never surface to the visitor.

import { getDatabase } from '@netlify/database';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*'
};

const MAX_TERM_CHARS = 60;

// Keeps enough of what was typed to see which street was wanted, without
// keeping a house number, postcode or contact detail. Kept in sync by hand
// with the copy in log-analytics.js (self-contained-functions convention).
function minimiseSearchTerm(raw) {
  let t = String(raw || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 100);
  if (!t) return null;
  if (t.indexOf('@') !== -1) return '[removed]';
  const postcode = /\b[a-z]{1,2}\d[a-z\d]?\s?\d[a-z]{2}\b/g;
  if (t.replace(postcode, '').trim() === '' ) return '[postcode]';
  t = t.replace(postcode, ' ');
  t = t.replace(/\b\d+[a-z]?\b/g, ' ').replace(/\d+/g, ' ');
  t = t.replace(/\s+/g, ' ').trim().slice(0, MAX_TERM_CHARS);
  return t || '[number]';
}

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const data = await req.json();
    const db = getDatabase();

    const term = minimiseSearchTerm(data.searchTerm);
    const matchedStreet = data.matchedStreet ? String(data.matchedStreet).slice(0, 100) : null;
    const resultsCount = Math.max(0, Math.min(Number(data.resultsCount) || 0, 1000));
    const page = String(data.page || 'Unknown').split('?')[0].split('#')[0].slice(0, 100);

    await db.sql`
      INSERT INTO search_logs (search_term, match_found, matched_street, results_count, page)
      VALUES (${term}, ${!!data.matchFound}, ${matchedStreet}, ${resultsCount}, ${page})
    `;

    return new Response(JSON.stringify({ success: true, logged: true }), { status: 200, headers });
  } catch (error) {
    console.error('Search logging error:', error);
    return new Response(JSON.stringify({ error: 'Failed to log search event' }), { status: 500, headers });
  }
};
