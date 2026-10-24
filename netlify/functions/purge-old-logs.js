// Scheduled Netlify Function (daily; not reachable by a public URL) that
// enforces the retention periods stated in the privacy policy:
//   - street searches that found no match: deleted after 90 days
//   - all other street searches and site analytics events: 13 months
//   - Santa sighting reports: 30 days
//   - registration-attempt (anti-abuse) records, which hold an IP address:
//     24 hours
//   - cached TruTrak trails for past route nights (Blobs store 'trutrak'):
//     deleted once the night is over (kept for today and yesterday only)
// It also FLAGS volunteers with no login/volunteering activity for 3 years:
// on the 1st of each month, if there are any, the admin notification
// address gets a count-only email pointing at the admin Volunteers tab,
// where they are reviewed and deleted by hand. Nothing about volunteers is
// deleted automatically.
//
// Logs a count-only summary via console.log. Like other scheduled functions
// it only fires automatically on the production deploy; test with "Run now"
// in the Netlify dashboard.

import { getDatabase } from '@netlify/database';
import { getStore } from '@netlify/blobs';
import { findInactiveVolunteers } from '../lib/volunteer-retention.js';
import { brandedEmailHtml, sendEmail, REPLY_TO } from '../lib/email.js';

function londonDate(offsetDays) {
  const d = new Date(Date.now() + (offsetDays || 0) * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(d); // YYYY-MM-DD
}

async function purgeOldTrails() {
  const store = getStore('trutrak');
  const keep = new Set(['trail-' + londonDate(0), 'trail-' + londonDate(-1)]);
  const { blobs } = await store.list({ prefix: 'trail-' });
  let deleted = 0;
  for (const b of blobs) {
    if (!keep.has(b.key)) { await store.delete(b.key); deleted++; }
  }
  return deleted;
}

export default async () => {
  const summary = {};
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
    const oldSightings = await db.sql`
      DELETE FROM sightings WHERE created_at < now() - interval '30 days' RETURNING id
    `;
    const oldAttempts = await db.sql`
      DELETE FROM registration_attempts WHERE attempted_at < now() - interval '24 hours' RETURNING id
    `;
    summary.unmatchedSearchesDeleted = unmatched.length;
    summary.oldSearchesDeleted = oldSearches.length;
    summary.oldEventsDeleted = oldEvents.length;
    summary.sightingsDeleted = oldSightings.length;
    summary.registrationAttemptsDeleted = oldAttempts.length;

    try {
      summary.trailsDeleted = await purgeOldTrails();
    } catch (err) {
      console.error('purge-old-logs: trail purge failed:', err.message);
    }

    const inactive = await findInactiveVolunteers(db);
    summary.inactiveVolunteersFlagged = inactive.length;
    if (inactive.length > 0 && londonDate(0).endsWith('-01')) {
      try {
        const rows = await db.sql`SELECT value FROM settings WHERE key = 'registration_notify_email'`;
        const to = (rows.length && rows[0].value) || REPLY_TO;
        await sendEmail({
          to,
          subject: 'Santa Sleigh: volunteer records due for review',
          html: brandedEmailHtml({
            heading: 'Volunteer records due for review',
            paragraphs: [
              inactive.length + ' volunteer record' + (inactive.length === 1 ? ' has' : 's have') +
                ' had no login or volunteering activity for 3 years.',
              'Under our privacy policy these should be deleted unless there is a documented legal or safety reason to keep them. ' +
                'Review them under "Review for deletion" on the admin Volunteers tab.'
            ],
            button: { label: 'Open admin', url: 'https://santasleighsalford.co.uk/admin.html' }
          })
        });
        summary.inactiveReviewEmailSent = true;
      } catch (err) {
        console.error('purge-old-logs: review email failed:', err.message);
      }
    }

    console.log('purge-old-logs summary:', JSON.stringify(summary));
  } catch (error) {
    console.error('purge-old-logs fatal error:', error);
  }
};

export const config = {
  schedule: '30 3 * * *'
};
