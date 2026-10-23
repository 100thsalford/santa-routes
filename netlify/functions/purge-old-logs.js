// Scheduled Netlify Function (daily; not reachable by a public URL) that
// enforces the retention periods stated in the privacy policy:
//   - street searches that found no match: deleted after 90 days (long
//     enough to spot streets we are missing)
//   - all other street searches and site analytics events: deleted after
//     13 months (long enough to compare one season with the next)
// Logs a summary via console.log. Like other scheduled functions it only
// fires automatically on the production deploy; test with "Run now" in the
// Netlify dashboard.

import { getDatabase } from '@netlify/database';

export default async () => {
  try {
    const db = getDatabase();
    const unmatched = await db.sql`
      DELETE FROM search_logs
      WHERE match_found = FALSE AND created_at < now() - interval '90 days'
      RETURNING id
    `;
    const oldSearches = await db.sql`
      DELETE FROM search_logs WHERE created_at < now() - interval '13 months' RETURNING id
    `;
    const oldEvents = await db.sql`
      DELETE FROM analytics_events WHERE created_at < now() - interval '13 months' RETURNING id
    `;
    console.log('purge-old-logs summary:', JSON.stringify({
      unmatchedSearchesDeleted: unmatched.length,
      oldSearchesDeleted: oldSearches.length,
      oldEventsDeleted: oldEvents.length
    }));
  } catch (error) {
    console.error('purge-old-logs fatal error:', error);
  }
};

export const config = {
  schedule: '30 3 * * *'
};
