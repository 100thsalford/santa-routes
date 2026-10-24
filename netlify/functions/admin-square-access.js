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
import { brandedEmailHtml, escapeHtml, sendEmail, siteUrls } from '../lib/email.js';
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
        subject: 'Approved: Santa Sleigh card payments ✅',
        html: brandedEmailHtml({
          status: { tone: 'approved', label: 'Approved' },
          heading: "You're set up to take card payments",
          paragraphs: [
            first ? 'Hi ' + first + ',' : 'Hi,',
            'You\'ve been added to our Square account. Look out for an email from <strong>Square</strong> to <strong>' + escapeHtml(to) + '</strong> inviting you to join our team (check spam too) and accept it to set up your login.',
            'Then sign in to the <strong>Square Point of Sale</strong> app with that login (' +
              '<a href="' + SQUARE_APP_LINKS.ios + '" style="color:#1E5B45;">iPhone</a> / ' +
              '<a href="' + SQUARE_APP_LINKS.android + '" style="color:#1E5B45;">Android</a>) and turn on Tap to Pay under <em>More › Settings</em>.',
            'Please only take donations while you\'re out with the Sleigh, and keep your phone locked when it\'s not in use.'
          ],
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
