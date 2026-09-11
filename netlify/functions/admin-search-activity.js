// Returns a lightweight summary of street search activity for the admin
// "Search Activity" tab: headline counts, the most common searches that
// found no match (useful for spotting street name spellings/aliases worth
// adding), and the most recent searches. Requires a logged-in Identity
// user with the 'admin' role.

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';

const headers = { 'Content-Type': 'application/json' };

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

    const [totalsRows, noMatchTermRows, recentRows] = await Promise.all([
      db.sql`
        SELECT
          COUNT(*) AS total,
          COUNT(*) FILTER (WHERE match_found = FALSE) AS no_match,
          COUNT(*) FILTER (WHERE created_at >= now() - interval '7 days') AS last_7_days
        FROM search_logs
      `,
      db.sql`
        SELECT search_term, COUNT(*) AS count
        FROM search_logs
        WHERE match_found = FALSE AND search_term IS NOT NULL AND search_term <> ''
        GROUP BY search_term
        ORDER BY count DESC, search_term ASC
        LIMIT 10
      `,
      db.sql`
        SELECT id, created_at, search_term, match_found, matched_street, results_count
        FROM search_logs
        ORDER BY created_at DESC
        LIMIT 50
      `
    ]);

    const totals = totalsRows[0] || { total: 0, no_match: 0, last_7_days: 0 };

    return new Response(JSON.stringify({
      totals: {
        total: Number(totals.total),
        noMatch: Number(totals.no_match),
        last7Days: Number(totals.last_7_days)
      },
      topNoMatchTerms: noMatchTermRows.map((r) => ({ term: r.search_term, count: Number(r.count) })),
      recent: recentRows.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        searchTerm: r.search_term,
        matchFound: r.match_found,
        matchedStreet: r.matched_street,
        resultsCount: r.results_count
      }))
    }), { status: 200, headers });
  } catch (error) {
    console.error('Error fetching search activity:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
