// Volunteer self-service request for access to take card payments with
// Square (Tap to Pay on their own phone).
//
// POST (no body): an approved volunteer who is signed up to an upcoming
// night is created as a Square team member (Team API), then:
//   - the admin is emailed with a link to finish setup in the Square
//     Dashboard (permission set + passcode -- not possible via the API,
//     and that's what makes Square send the volunteer their invitation),
//   - the volunteer is emailed "pending review" + download-the-app steps.
// Asking again once requested just returns the current state.
//
// Returns { squareAccess } -- same shape as get-volunteer-profile's.

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { getVolunteerAccess, notApprovedResponse } from '../lib/volunteer-access.js';
import { brandedEmailHtml, escapeHtml, sendEmail, siteUrls, REPLY_TO } from '../lib/email.js';
import {
  findOrCreateTeamMember, squareAccessState, squareConfigured,
  SQUARE_TEAM_DASHBOARD_URL, SQUARE_APP_LINKS
} from '../lib/square.js';

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers });
}

async function notifyAdmin(db, req, v, squareEmail, reused) {
  const rows = await db.sql`SELECT value FROM settings WHERE key = 'registration_notify_email'`;
  const to = (rows.length && String(rows[0].value || '').trim()) || REPLY_TO;
  const urls = siteUrls(req);
  const html = brandedEmailHtml({
    status: { tone: 'pending', label: 'Needs setting up in Square' },
    heading: 'Card payment access requested',
    paragraphs: [
      '<strong>' + escapeHtml(v.full_name || v.email) + '</strong><br>' + escapeHtml(squareEmail),
      (reused
        ? 'They were already in our Square team (re-activated if needed).'
        : "They've been added to our Square team.") +
        ' To finish, open them in the Square Dashboard (<em>Staff › Team › Team members</em>), assign the volunteer permission set and a passcode, and save. Square then emails them an invitation.',
      'Once that\'s done, press <strong>Mark approved</strong> in the admin Volunteers tab so their portal shows they\'re ready.'
    ],
    button: { label: 'Open Square team members', url: SQUARE_TEAM_DASHBOARD_URL },
    footnote: 'Mark them approved: <a href="' + escapeHtml(urls.admin + '#square-access') + '" style="color:#1E5B45;">' + escapeHtml(urls.admin + '#square-access') + '</a>'
  });
  await sendEmail({ to, subject: 'Square access to approve: ' + (v.full_name || v.email), html });
}

async function emailVolunteer(req, v, squareEmail) {
  const first = v.full_name ? escapeHtml(String(v.full_name).split(' ')[0]) : '';
  const urls = siteUrls(req);
  const html = brandedEmailHtml({
    status: { tone: 'pending', label: 'Pending review' },
    heading: "We've got your card payments request",
    paragraphs: [
      first ? 'Hi ' + first + ',' : 'Hi,',
      'Thanks for offering to take card donations on the Sleigh. Your request is now <strong>Pending review</strong>. One of the team will set you up in our Square account shortly.',
      '<strong>While you wait, download the free Square Point of Sale app:</strong><br>' +
        '📱 iPhone: <a href="' + SQUARE_APP_LINKS.ios + '" style="color:#1E5B45;">App Store</a><br>' +
        '🤖 Android: <a href="' + SQUARE_APP_LINKS.android + '" style="color:#1E5B45;">Google Play</a>',
      'When you\'re approved, <strong>Square</strong> will email <strong>' + escapeHtml(squareEmail) + '</strong> an invitation to join our team. Accept it to set up your Square login, then sign in to the app with it. Don\'t create a new Square business account.',
      'Before your first night, turn on Tap to Pay in the app (<em>More › Settings</em>) and check you have mobile data.'
    ],
    button: { label: 'Open the volunteer portal', url: urls.volunteerLogin },
    footnote: 'Phone needs: iPhone XS or newer on the latest iOS, or Android 9+ with NFC turned on. Didn\'t ask for this? Just reply to this email.'
  });
  await sendEmail({ to: squareEmail, subject: 'Pending review: Santa Sleigh card payments', html });
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const user = await getUser();
    if (!user) return json({ error: 'Not logged in' }, 401);

    const db = getDatabase();
    const access = await getVolunteerAccess(db, user);
    if (access.status !== 'approved') return notApprovedResponse(access.status, headers);
    if (!access.volunteerId) return json({ error: 'Open the portal once first, then try again.' }, 409);
    if (!squareConfigured()) return json({ error: 'Card payment sign-up isn\'t switched on yet. Please ask the team.' }, 503);

    const state = await squareAccessState(db, access.volunteerId);
    if (state.status !== 'none') return json({ squareAccess: state });
    if (!state.eligible) {
      return json({ error: 'Sign up for an upcoming night first, then you can ask for card payment access.' }, 403);
    }

    // Claim the request first so a double tap can't create two members.
    const claimed = await db.sql`
      UPDATE volunteers SET square_requested_at = NOW(), updated_at = NOW()
      WHERE id = ${access.volunteerId} AND square_requested_at IS NULL
      RETURNING email, preferred_email, full_name
    `;
    if (!claimed.length) return json({ squareAccess: await squareAccessState(db, access.volunteerId) });
    const v = claimed[0];
    const squareEmail = String(v.preferred_email || v.email || '').trim();

    let result;
    try {
      if (!squareEmail) throw new Error('No email address on your profile');
      result = await findOrCreateTeamMember({ volunteerId: access.volunteerId, fullName: v.full_name, email: squareEmail });
    } catch (err) {
      console.error('volunteer-square-access: Square failed:', err.message);
      await db.sql`UPDATE volunteers SET square_requested_at = NULL WHERE id = ${access.volunteerId}`;
      return json({ error: "We couldn't add you to Square just now. Please try again later or contact the team." }, 502);
    }

    await db.sql`
      UPDATE volunteers SET square_team_member_id = ${result.member.id}, square_email = ${squareEmail}, square_approved_at = NULL
      WHERE id = ${access.volunteerId}
    `;

    // Emails are best-effort: the request itself has gone through.
    try { await notifyAdmin(db, req, v, squareEmail, result.reused); } catch (err) { console.error('Square admin email failed:', err.message); }
    let emailed = true;
    try { await emailVolunteer(req, v, squareEmail); } catch (err) { console.error('Square volunteer email failed:', err.message); emailed = false; }

    return json({ squareAccess: await squareAccessState(db, access.volunteerId), emailed });
  } catch (error) {
    console.error('Error requesting Square access:', error);
    return json({ error: error.message }, 500);
  }
};
