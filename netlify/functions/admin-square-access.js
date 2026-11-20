// Admin-only: manage volunteers' Square card-payment access.
//
// POST body: { volunteerId, op: 'approve' | 'revoke' }
//   approve -- you've assigned their permission set + passcode in the
//              Square Dashboard; marks them approved and emails them
//              next steps. Square can't tell us this itself (no API or
//              webhook for permissions), hence the manual step.
//   revoke  -- deactivates their Square team member and clears the
//              request (e.g. end of season); they can ask again later.

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { actionStepsHtml, brandedEmailHtml, escapeHtml, sendEmail, siteUrls, warningBoxHtml } from '../lib/email.js';
import { setTeamMemberStatus, SQUARE_APP_LINKS } from '../lib/square.js';

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers });
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const user = await getUser();
    if (!(user && user.roles && user.roles.includes('admin'))) return json({ error: 'Admin access required' }, 403);

    const body = await req.json();
    const volunteerId = parseInt(body.volunteerId, 10);
    const op = body.op;
    if (!volunteerId || (op !== 'approve' && op !== 'revoke')) {
      return json({ error: 'volunteerId and an op of approve/revoke are required' }, 400);
    }

    const db = getDatabase();
    const rows = await db.sql`
      SELECT full_name, email, square_email, square_team_member_id, square_requested_at
      FROM volunteers WHERE id = ${volunteerId}
    `;
    if (!rows.length) return json({ error: 'Volunteer not found' }, 404);
    const v = rows[0];
    if (!v.square_requested_at) return json({ error: 'They haven\'t requested card payment access' }, 409);

    if (op === 'revoke') {
      if (v.square_team_member_id) {
        try {
          await setTeamMemberStatus(v.square_team_member_id, 'INACTIVE');
        } catch (err) {
          if (!/not\s*found/i.test(err.message)) return json({ error: err.message }, 502);
        }
      }
      await db.sql`
        UPDATE volunteers SET square_team_member_id = NULL, square_email = NULL,
          square_requested_at = NULL, square_approved_at = NULL, updated_at = NOW()
        WHERE id = ${volunteerId}
      `;
      return json({ success: true });
    }

    await db.sql`UPDATE volunteers SET square_approved_at = NOW(), updated_at = NOW() WHERE id = ${volunteerId}`;

    const to = v.square_email || v.email;
    const first = v.full_name ? escapeHtml(String(v.full_name).split(' ')[0]) : '';
    const urls = siteUrls(req);
    let emailed = true;
    try {
      await sendEmail({
        to,
        subject: 'Approved ✅ Accept your Square invite, then sign in to the app',
        html: brandedEmailHtml({
          status: { tone: 'approved', label: 'Approved' },
          heading: 'Accept your Square invite, then sign in',
          paragraphs: [
            first ? 'Hi ' + first + ',' : 'Hi,',
            'You\'ve been added to our Square account. <strong>Square has already sent you a separate invitation email</strong>, and you need it to get your login. Follow these steps in order:'
          ],
          bodyHtml:
            actionStepsHtml('Do these two things', [
              {
                title: 'Accept the invitation email from Square',
                html: 'It\'s from <strong>Square</strong> (not us), sent to <strong>' + escapeHtml(to) + '</strong>, and should already be in your inbox. Check spam/junk if you can\'t see it. Open it, tap the button to accept, and set a password. That email address and password are your Square login.'
              },
              {
                title: 'Sign in to the Square Point of Sale app with that login',
                html: 'Open the app (' +
                  '<a href="' + SQUARE_APP_LINKS.ios + '" style="color:#1E5B45;">iPhone</a> / ' +
                  '<a href="' + SQUARE_APP_LINKS.android + '" style="color:#1E5B45;">Android</a>' +
                  '), tap <strong>Sign in</strong> and use the email and password from step 1. Then turn on Tap to Pay under <em>More › Settings</em>.'
              }
            ]) +
            warningBoxHtml(
              'Don\'t create a new Square account',
              'Only use the login from Square\'s invitation. Tapping "Sign up" in the app makes a separate account that can\'t take donations for the Sleigh. No invitation from Square? Reply to this email and we\'ll resend it.'
            ) +
            '<p style="margin:0 0 16px; font-size:16px; line-height:1.6; color:#24272E;">Please only take donations while you\'re out with the Sleigh, and keep your phone locked when it\'s not in use.</p>',
          button: { label: 'Open the volunteer portal', url: urls.volunteerLogin }
        })
      });
    } catch (err) {
      console.error('Square approved email failed:', err.message);
      emailed = false;
    }
    return json({ success: true, emailed });
  } catch (error) {
    console.error('Error updating Square access:', error);
    return json({ error: error.message }, 500);
  }
};
