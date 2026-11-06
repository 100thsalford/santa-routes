// Scheduled Netlify Function (every 15 minutes; not reachable by a public
// URL) that emails volunteers with mailbox access when new mail has
// arrived in the hello@ inbox.
//
// To save Resend quota (received AND sent emails count against it, and
// each alert is one email per recipient), alerts are batched: at most one
// alert every 30 minutes, listing what's new since the last one. Volunteers
// can switch alerts off from the Mailbox page (volunteers.mailbox_alerts).
//
// State is kept in settings.mailbox_alert_state as JSON:
//   { lastSeen: <inbox last_received ISO>, lastAlertAt: <ISO> }
// On the very first run it just records the current position, so turning
// this on doesn't alert about mail that was already there.
//
// Like other scheduled functions it only fires automatically on the
// production deploy; test with "Run now" in the Netlify dashboard.

import { getDatabase } from '@netlify/database';
import { brandedEmailHtml, escapeHtml, sendEmail } from '../lib/email.js';
import { MAILBOX_ADDRESS, mailboxConfigured, getInbox, listThreads } from '../lib/mailbox.js';

const STATE_KEY = 'mailbox_alert_state';
const MIN_GAP_MS = 30 * 60 * 1000;
const PORTAL_MAILBOX_URL = 'https://santasleighsalford.co.uk/mailbox.html';

async function readState(db) {
  const rows = await db.sql`SELECT value FROM settings WHERE key = ${STATE_KEY}`;
  if (!rows.length) return null;
  try { return JSON.parse(rows[0].value); } catch (e) { return null; }
}

async function writeState(db, state) {
  const value = JSON.stringify(state);
  await db.sql`
    INSERT INTO settings (key, value, updated_at) VALUES (${STATE_KEY}, ${value}, NOW())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
  `;
}

function shortFrom(from) {
  const s = String(from || '').trim();
  const m = s.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  return (m ? m[1] : s) || 'Unknown sender';
}

export default async () => {
  const summary = { checked: false, newThreads: 0, alertsSent: 0, skipped: null };
  try {
    if (!mailboxConfigured()) { summary.skipped = 'no API key'; return; }
    const db = getDatabase();

    const inbox = await getInbox();
    const lastReceived = inbox && inbox.last_received;
    const state = await readState(db);
    summary.checked = true;

    if (!state) {
      await writeState(db, { lastSeen: lastReceived || new Date().toISOString(), lastAlertAt: null });
      summary.skipped = 'first run: position recorded';
      return;
    }
    if (!lastReceived || String(lastReceived) <= String(state.lastSeen || '')) {
      summary.skipped = 'nothing new';
      return;
    }
    if (state.lastAlertAt && Date.now() - Date.parse(state.lastAlertAt) < MIN_GAP_MS) {
      summary.skipped = 'alerted under 30 minutes ago';
      return; // lastSeen not moved, so the next run picks these up
    }

    const threads = await listThreads({ folder: 'inbox', read: false, limit: 20 });
    const fresh = (threads && threads.data ? threads.data : [])
      .filter((t) => String(t.received_at || '') > String(state.lastSeen || ''));
    summary.newThreads = fresh.length;

    if (!fresh.length) {
      await writeState(db, { lastSeen: lastReceived, lastAlertAt: state.lastAlertAt || null });
      summary.skipped = 'new mail already read';
      return;
    }

    const recipients = await db.sql`
      SELECT full_name, email, preferred_email FROM volunteers
      WHERE mailbox_access = true AND mailbox_alerts = true AND is_guest = false AND approval_status = 'approved'
    `;

    const list = fresh.slice(0, 10).map((t) =>
      '<li style="margin:0 0 8px;"><strong>' + escapeHtml(shortFrom(t.from)) + '</strong><br>' +
      '<span style="color:#5B6169;">' + escapeHtml(t.subject || '(no subject)') + '</span></li>'
    ).join('');
    const more = fresh.length > 10 ? '<p style="margin:0 0 16px; font-size:14px; color:#5B6169;">…and more.</p>' : '';
    const unread = inbox.unread || fresh.length;

    for (const r of recipients) {
      const to = String(r.preferred_email || r.email || '').trim();
      if (!to) continue;
      const first = r.full_name ? escapeHtml(String(r.full_name).split(' ')[0]) : '';
      try {
        await sendEmail({
          to,
          subject: 'New email in ' + MAILBOX_ADDRESS + ' (' + fresh.length + ')',
          html: brandedEmailHtml({
            heading: 'New email in the mailbox',
            paragraphs: [
              first ? 'Hi ' + first + ',' : 'Hi,',
              fresh.length + ' new conversation' + (fresh.length === 1 ? '' : 's') + ' in <strong>' + escapeHtml(MAILBOX_ADDRESS) + '</strong>' +
                (unread > fresh.length ? ' (' + unread + ' unread in total)' : '') + ':'
            ],
            bodyHtml: '<ul style="margin:0 0 16px; padding-left:20px; font-size:15px; line-height:1.4; color:#24272E;">' + list + '</ul>' + more,
            button: { label: 'Open the mailbox', url: PORTAL_MAILBOX_URL },
            footnote: 'You get these because you have mailbox access in the volunteer portal. Turn them off on the Mailbox page. Please reply from the portal, not from this email.'
          })
        });
        summary.alertsSent++;
      } catch (err) {
        console.error('mailbox-alerts: alert failed:', err.message);
      }
    }

    await writeState(db, { lastSeen: lastReceived, lastAlertAt: new Date().toISOString() });
  } catch (err) {
    console.error('mailbox-alerts error:', err.message);
  } finally {
    console.log('mailbox-alerts summary:', JSON.stringify(summary));
  }
};

export const config = {
  schedule: '*/15 * * * *'
};
