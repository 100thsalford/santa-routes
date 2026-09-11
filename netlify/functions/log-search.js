// Logs a street search from index.html's "When is Santa visiting?" search
// box into the search_logs table. This used to POST to a Google Sheets
// webhook (GOOGLE_SHEETS_WEBHOOK_URL) with only a 24-hour Netlify function
// log as fallback -- moved onto the same Postgres DB as the rest of the
// site so search history has a permanent, queryable home. Fire-and-forget
// from the client (analytics.js), so failures here should never surface
// to the visitor.

import { getDatabase } from '@netlify/database';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*'
};

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const data = await req.json();
    const db = getDatabase();

    const geo = context.geo || {};
    const userAgent = req.headers.get('user-agent') || 'Unknown';
    const referer = req.headers.get('referer') || 'Direct';
    const ip = context.ip
      || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
      || req.headers.get('client-ip')
      || 'Unknown';
    const country = (geo.country && geo.country.name) || req.headers.get('x-country') || 'Unknown';
    const city = geo.city || req.headers.get('x-city') || 'Unknown';
    const region = (geo.subdivision && geo.subdivision.code) || req.headers.get('x-subdivision-code') || 'Unknown';

    await db.sql`
      INSERT INTO search_logs (
        search_term, match_found, matched_street, results_count,
        page, user_agent, referer, ip, country, city, region
      )
      VALUES (
        ${data.searchTerm || null}, ${!!data.matchFound}, ${data.matchedStreet || null}, ${data.resultsCount || 0},
        ${data.page || 'Unknown'}, ${userAgent}, ${referer}, ${ip}, ${country}, ${city}, ${region}
      )
    `;

    return new Response(JSON.stringify({ success: true, logged: true }), { status: 200, headers });
  } catch (error) {
    console.error('Search logging error:', error);
    return new Response(JSON.stringify({ error: 'Failed to log search event' }), { status: 500, headers });
  }
};
