// Logs a general site analytics event (page views, tab switches, donation
// clicks, sighting reports, time-on-page pings, etc.) from analytics.js
// into the analytics_events table. This used to POST to a Google Sheets
// webhook (GOOGLE_SHEETS_ANALYTICS_WEBHOOK_URL) with only a 24-hour Netlify
// function log as fallback -- moved onto the same Postgres DB as the rest
// of the site. Fire-and-forget from the client, so failures here should
// never surface to the visitor.

import { getDatabase } from '@netlify/database';

const headers = { 'Content-Type': 'application/json' };

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const data = await req.json();
    const db = getDatabase();

    const userAgent = req.headers.get('user-agent') || 'Unknown';
    const referer = req.headers.get('referer') || 'Direct';
    const ip = context.ip
      || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim()
      || 'Unknown';

    await db.sql`
      INSERT INTO analytics_events (event_type, event_data, page, user_agent, referer, ip)
      VALUES (
        ${data.eventType || 'unknown'}, ${JSON.stringify(data.eventData || {})}::jsonb,
        ${data.page || 'Unknown'}, ${userAgent}, ${referer}, ${ip}
      )
    `;

    return new Response(JSON.stringify({ success: true }), { status: 200, headers });
  } catch (error) {
    console.error('Analytics error:', error);
    return new Response(JSON.stringify({ error: 'Failed to log event' }), { status: 500, headers });
  }
};
