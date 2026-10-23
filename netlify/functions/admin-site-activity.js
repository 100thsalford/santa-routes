// Returns view-count stats for the admin "Site Activity" tab, specifically
// for the live sleigh-tracking page (track.html) -- Nathan wants to know
// how many people are viewing it. Built from the same cookie-free
// analytics_events rows that analytics.js already logs on every page load
// (see log-analytics.js) -- no new tracking or cookies added. "Unique
// visitors" is an approximation (distinct IP address per period), since no
// visitor/session ID is stored anywhere in this pipeline. Raw IPs/user
// agents are never returned here, only aggregate counts. Requires a
// logged-in Identity user with the 'admin' role.

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';

const headers = { 'Content-Type': 'application/json' };
const TRACK_PAGE = '/track.html';

function requireAdmin(user) {
  return !!(user && user.roles && user.roles.includes('admin'));
}

export default async (req, context) => {
  try {
    const user = await getUser();
    if (!requireAdmin(user)) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers });
    }

    const db = getDatabase();

    const [totalsRows, dailyRows] = await Promise.all([
      db.sql`
        SELECT
          COUNT(*) AS total_views,
          COUNT(*) FILTER (WHERE created_at >= now() - interval '24 hours') AS views_24h,
          COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days') AS views_7d,
          COUNT(DISTINCT ip) AS unique_all_time,
          COUNT(DISTINCT ip) FILTER (WHERE created_at >= now() - interval '24 hours') AS unique_24h,
          COUNT(DISTINCT ip) FILTER (WHERE created_at >= now() - interval '7 days') AS unique_7d
        FROM analytics_events
        WHERE page = ${TRACK_PAGE} AND event_type = 'page_view'
      `,
      db.sql`
        SELECT
          date_trunc('day', created_at) AS day,
          COUNT(*) AS views,
          COUNT(DISTINCT ip) AS unique_visitors
        FROM analytics_events
        WHERE page = ${TRACK_PAGE} AND event_type = 'page_view'
          AND created_at >= now() - interval '14 days'
        GROUP BY day
        ORDER BY day DESC
      `
    ]);

    const t = totalsRows[0] || {
      total_views: 0, views_24h: 0, views_7d: 0,
      unique_all_time: 0, unique_24h: 0, unique_7d: 0
    };

    return new Response(JSON.stringify({
      totals: {
        totalViews: Number(t.total_views),
        views24h: Number(t.views_24h),
        views7d: Number(t.views_7d),
        uniqueAllTime: Number(t.unique_all_time),
        unique24h: Number(t.unique_24h),
        unique7d: Number(t.unique_7d)
      },
      daily: dailyRows.map((r) => ({
        day: r.day,
        views: Number(r.views),
        uniqueVisitors: Number(r.unique_visitors)
      }))
    }), { status: 200, headers });
  } catch (error) {
    console.error('Error fetching site activity:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
