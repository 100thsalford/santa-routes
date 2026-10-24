// Lets a logged-in volunteer update their own settings. Requires a valid
// Netlify Identity JWT (see get-volunteer-profile.js).
//
// POST body -- any of (fields left out are unchanged):
//   reminderEmailOptIn: boolean
//   preferredEmail:     string | null -- their contact email for reminders,
//                       broadcasts and the Square invite. Blank/null, or the
//                       same as their login email, clears it (= use login
//                       email). They still log in with their login email.
//
// Changing the contact email sends a heads-up to the previous address, so a
// mistaken or unwanted change doesn't go unnoticed.

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { getVolunteerAccess, notApprovedResponse } from '../lib/volunteer-access.js';
import { brandedEmailHtml, escapeHtml, sendEmail } from '../lib/email.js';

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

function json(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers });
}

export default async (req, context) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const user = await getUser();
    if (!user) return json({ error: 'Not logged in' }, 401);

    const body = await req.json();
    const db = getDatabase();

    const access = await getVolunteerAccess(db, user);
    if (access.status !== 'approved') return notApprovedResponse(access.status, headers);

    // Accounts made the old way (Netlify dashboard invite) may not have a row yet.
    await db.sql`
      INSERT INTO volunteers (identity_user_id, email) VALUES (${user.id}, ${user.email})
      ON CONFLICT (identity_user_id) DO NOTHING
    `;
    const current = (await db.sql`
      SELECT email, preferred_email, reminder_email_opt_in, full_name
      FROM volunteers WHERE identity_user_id = ${user.id}
    `)[0];

    let reminderEmailOptIn = current.reminder_email_opt_in;
    if (typeof body.reminderEmailOptIn === 'boolean') reminderEmailOptIn = body.reminderEmailOptIn;

    let preferredEmail = current.preferred_email;
    if (Object.prototype.hasOwnProperty.call(body, 'preferredEmail')) {
      const raw = typeof body.preferredEmail === 'string' ? body.preferredEmail.trim() : '';
      if (raw && (raw.length > 254 || !EMAIL_RE.test(raw))) {
        return json({ error: 'That doesn\'t look like a valid email address.' }, 400);
      }
      preferredEmail = raw && raw.toLowerCase() !== String(current.email || '').toLowerCase() ? raw : null;
    }

    const rows = await db.sql`
      UPDATE volunteers
      SET reminder_email_opt_in = ${reminderEmailOptIn}, preferred_email = ${preferredEmail}, updated_at = NOW()
      WHERE identity_user_id = ${user.id}
      RETURNING email, reminder_email_opt_in, preferred_email
    `;
    const profile = rows[0];

    const oldContact = current.preferred_email || current.email;
    const newContact = profile.preferred_email || profile.email;
    let notified = null;
    if (oldContact && String(oldContact).toLowerCase() !== String(newContact).toLowerCase()) {
      const first = current.full_name ? escapeHtml(String(current.full_name).split(' ')[0]) : '';
      try {
        await sendEmail({
          to: oldContact,
          subject: 'Your Santa Sleigh contact email was changed',
          html: brandedEmailHtml({
            heading: 'Contact email changed',
            paragraphs: [
              first ? 'Hi ' + first + ',' : 'Hi,',
              'Your Santa Super Sleigh Salford volunteer emails (shift reminders and team updates) will now go to <strong>' + escapeHtml(newContact) + '</strong> instead of this address.',
              'You still log in to the volunteer portal with <strong>' + escapeHtml(profile.email) + '</strong>.',
              'If you didn\'t make this change, just reply to this email and we\'ll sort it out.'
            ]
          })
        });
        notified = true;
      } catch (err) {
        console.error('Contact email change notice failed:', err.message);
        notified = false;
      }
    }

    return json({
      email: profile.email,
      reminderEmailOptIn: profile.reminder_email_opt_in,
      preferredEmail: profile.preferred_email,
      notified
    });
  } catch (error) {
    console.error('Error updating volunteer profile:', error);
    return json({ error: error.message }, 500);
  }
};
