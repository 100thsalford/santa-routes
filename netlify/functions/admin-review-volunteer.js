// Admin-only approve/reject for volunteers who registered themselves on
// the helpout page (approval_status 'pending'). Rejected accounts are kept
// (marked 'rejected', unable to see shifts) so an admin can change their
// mind later -- approving a rejected volunteer works the same way.
//
// Sends the volunteer a branded email either way.
//
// POST body: { volunteerId, decision: 'approve' | 'reject' }

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { brandedEmailHtml, escapeHtml, sendEmail, siteUrls } from '../lib/email.js';

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function requireAdmin(user) {
  return !!(user && user.roles && user.roles.includes('admin'));
}

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const user = await getUser();
    if (!requireAdmin(user)) {
      return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers });
    }

    const body = await req.json();
    const volunteerId = parseInt(body.volunteerId, 10);
    const decision = body.decision;
    if (!volunteerId || (decision !== 'approve' && decision !== 'reject')) {
      return new Response(JSON.stringify({ error: 'volunteerId and a decision of approve/reject are required' }), { status: 400, headers });
    }

    const db = getDatabase();
    const status = decision === 'approve' ? 'approved' : 'rejected';
    const rows = await db.sql`
      UPDATE volunteers SET approval_status = ${status}, reviewed_at = NOW(), updated_at = NOW()
      WHERE id = ${volunteerId} AND identity_user_id IS NOT NULL
      RETURNING email, preferred_email, full_name
    `;
    if (rows.length === 0) {
      return new Response(JSON.stringify({ error: 'Volunteer not found' }), { status: 404, headers });
    }

    if (status === 'rejected') {
      // Shouldn't normally exist for an unapproved account, but make sure a
      // rejected volunteer isn't left on any shift or role slot.
      await db.sql`DELETE FROM shift_assignments WHERE volunteer_id = ${volunteerId}`;
      await db.sql`UPDATE event_role_assignments SET volunteer_id = NULL WHERE volunteer_id = ${volunteerId}`;
    }

    const v = rows[0];
    const to = v.preferred_email || v.email;
    const greeting = v.full_name ? 'Hi ' + escapeHtml(String(v.full_name).split(' ')[0]) + ',' : 'Hi,';
    const urls = siteUrls(req);
    const email = status === 'approved'
      ? {
          subject: 'Approved: Santa Sleigh Volunteer ✅',
          html: brandedEmailHtml({
            status: { tone: 'approved', label: 'Approved' },
            heading: "You're in! Welcome to the team",
            paragraphs: [
              greeting,
              'Good news: your Santa Super Sleigh Salford volunteer registration is now <strong>Approved</strong>.',
              'Log in to the volunteer portal to see the nights we\'re out and pick the ones you can help with.'
            ],
            button: { label: 'Choose my shifts', url: urls.volunteerLogin },
            footnote: 'Forgotten your password? Use "Forgot password?" on the login screen.'
          })
        }
      : {
          subject: 'Your Santa Sleigh volunteer registration',
          html: brandedEmailHtml({
            heading: 'Thanks for registering',
            paragraphs: [
              greeting,
              'Thank you for offering to help Santa Super Sleigh Salford. We\'re not able to approve your volunteer registration this time.',
              'If you think this is a mistake, or you\'d like to know more, just reply to this email.'
            ]
          })
        };

    let emailed = true;
    try {
      if (!to) throw new Error('No email address on file');
      await sendEmail({ to, subject: email.subject, html: email.html });
    } catch (err) {
      console.error('Review email failed:', err.message);
      emailed = false;
    }

    return new Response(JSON.stringify({ success: true, status, emailed }), { status: 200, headers });
  } catch (error) {
    console.error('Error reviewing volunteer:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
