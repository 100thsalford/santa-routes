// Public volunteer registration, called by the helpout page (helpout.html).
//
// Two routes in:
//   * sign-up code (settings.signup_code, case-insensitive) -> account
//     created as approval_status 'pending'; an admin approves/rejects it
//     from the Volunteers tab (admin-review-volunteer.js).
//   * one-time branded invite token (admin-invite-volunteer.js) -> no code
//     needed, email fixed to the invited address, created as 'approved'.
//
// The Identity user is created here with admin.createUser (auto-confirmed,
// so no unbranded Netlify confirmation email), which works while Identity
// registration stays "Invite only" -- this function is the only way in,
// so the sign-up code can't be skipped by calling the Identity API
// directly. The volunteers row is inserted straight after; if that fails
// the Identity user is deleted again so nobody ends up with a login but no
// pending row (which would count as approved -- see lib/volunteer-access).
//
// POST body: { fullName, email, phone?, password, code?, inviteToken?, website? }
// (website is a honeypot field hidden from people.)

import { admin } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { createHash } from 'node:crypto';
import { corsHeaders } from '../lib/helpout-cors.js';
import { brandedEmailHtml, escapeHtml, sendEmail, siteUrls } from '../lib/email.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_BAD_CODES_PER_HOUR = 10;
const MAX_REGISTRATIONS_PER_HOUR = 5;

function normaliseCode(value) {
  return String(value || '').trim().toLowerCase();
}

async function recordAttempt(db, ip, kind) {
  await db.sql`INSERT INTO registration_attempts (ip, kind) VALUES (${ip}, ${kind})`;
  await db.sql`DELETE FROM registration_attempts WHERE attempted_at < NOW() - INTERVAL '1 day'`;
}

async function notifyAdmin(db, req, volunteer, viaInvite) {
  const rows = await db.sql`SELECT value FROM settings WHERE key = 'registration_notify_email'`;
  const to = rows.length ? String(rows[0].value || '').trim() : '';
  if (!to) return;
  const urls = siteUrls(req);
  const details = '<strong>' + escapeHtml(volunteer.fullName) + '</strong><br>' +
    escapeHtml(volunteer.email) + (volunteer.phone ? '<br>' + escapeHtml(volunteer.phone) : '');
  const html = viaInvite
    ? brandedEmailHtml({
        heading: 'Invite accepted',
        paragraphs: [details, 'They accepted your invite and created their account. They\'re already approved and can choose shifts now.'],
        button: { label: 'Open the Volunteers tab', url: urls.admin }
      })
    : brandedEmailHtml({
        heading: 'New volunteer registration',
        paragraphs: [details, 'They registered with the sign-up code and are waiting for you to approve or reject them.'],
        button: { label: 'Review in admin', url: urls.admin }
      });
  await sendEmail({
    to,
    subject: (viaInvite ? 'Invite accepted: ' : 'New volunteer to approve: ') + volunteer.fullName,
    html
  });
}

// Sent to code sign-ups straight away so they know it went through and
// what happens next. (Invite sign-ups are approved on the spot and the
// page itself tells them to log in, so they don't get this.)
async function sendPendingEmail(req, volunteer) {
  const first = escapeHtml(volunteer.fullName.split(' ')[0]);
  const html = brandedEmailHtml({
    heading: "Thanks, we've got your registration",
    paragraphs: [
      'Hi ' + first + ',',
      'Thanks for registering to help Santa Super Sleigh Salford. Your registration has been submitted and is waiting for one of our team to approve it.',
      "We'll email you again as soon as you're approved. Then you can log in to the volunteer portal and choose the nights you'd like to help with."
    ],
    footnote: "Didn't register? Just reply to this email and let us know."
  });
  await sendEmail({ to: volunteer.email, subject: 'Your Santa Sleigh volunteer registration is in 🎄', html });
}

export default async (req, context) => {
  const headers = corsHeaders(req, 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });

  try {
    const body = await req.json().catch(() => ({}));

    // Honeypot: bots fill every field. Pretend it worked, do nothing.
    if (body.website) return reply(200, { success: true, status: 'pending' });

    const fullName = String(body.fullName || '').trim().slice(0, 100);
    const phone = String(body.phone || '').trim().slice(0, 30) || null;
    const password = String(body.password || '');
    const inviteToken = String(body.inviteToken || '').trim();
    let email = String(body.email || '').trim().toLowerCase();

    if (!fullName) return reply(400, { error: 'Please enter your name.' });
    if (password.length < 8) return reply(400, { error: 'Please choose a password of at least 8 characters.' });

    const db = getDatabase();
    const ip = context.ip || 'unknown';

    const attemptRows = await db.sql`
      SELECT kind, COUNT(*)::int AS n FROM registration_attempts
      WHERE ip = ${ip} AND attempted_at > NOW() - INTERVAL '1 hour'
      GROUP BY kind
    `;
    const attempts = {};
    for (const r of attemptRows) attempts[r.kind] = r.n;
    if ((attempts.bad_code || 0) >= MAX_BAD_CODES_PER_HOUR || (attempts.registered || 0) >= MAX_REGISTRATIONS_PER_HOUR) {
      return reply(429, { error: 'Too many attempts from this connection. Please try again in an hour.' });
    }

    let approvalStatus;
    let source;
    let invite = null;

    if (inviteToken) {
      // Claim the invite atomically up front so the same link can't be
      // used twice in parallel; released again below if anything fails.
      const hash = createHash('sha256').update(inviteToken).digest('hex');
      const rows = await db.sql`
        UPDATE volunteer_invites SET used_at = NOW()
        WHERE token_hash = ${hash} AND used_at IS NULL AND cancelled_at IS NULL AND expires_at > NOW()
        RETURNING id, email
      `;
      if (rows.length === 0) {
        return reply(400, { error: 'This invite link has expired or has already been used. Ask us for a new one, or register with the sign-up code.' });
      }
      invite = rows[0];
      email = String(invite.email).trim().toLowerCase();
      approvalStatus = 'approved';
      source = 'invite';
    } else {
      if (!EMAIL_RE.test(email)) return reply(400, { error: 'Please enter a valid email address.' });
      const codeRows = await db.sql`SELECT value FROM settings WHERE key = 'signup_code'`;
      const expected = normaliseCode(codeRows.length ? codeRows[0].value : '');
      if (!expected) {
        return reply(403, { error: 'Registration is closed at the moment.', closed: true });
      }
      if (normaliseCode(body.code) !== expected) {
        await recordAttempt(db, ip, 'bad_code');
        return reply(400, { error: "That sign-up code isn't right. Check the email or message you were sent it in.", field: 'code' });
      }
      approvalStatus = 'pending';
      source = 'self';
    }

    const releaseInvite = async () => {
      if (invite) await db.sql`UPDATE volunteer_invites SET used_at = NULL WHERE id = ${invite.id}`;
    };

    let identityUser;
    try {
      identityUser = await admin.createUser({
        email,
        password,
        data: { user_metadata: { full_name: fullName } }
      });
    } catch (err) {
      await releaseInvite();
      if (err && (err.status === 422 || /already/i.test(err.message || ''))) {
        return reply(409, { error: 'There\'s already an account for this email. Log in instead, or use "Forgot password?" on the login screen.', exists: true });
      }
      throw err;
    }

    let volunteerId;
    try {
      const rows = await db.sql`
        INSERT INTO volunteers (identity_user_id, email, full_name, phone, approval_status, registration_source, registered_at)
        VALUES (${identityUser.id}, ${email}, ${fullName}, ${phone}, ${approvalStatus}, ${source}, NOW())
        RETURNING id
      `;
      volunteerId = rows[0].id;
    } catch (err) {
      try { await admin.deleteUser(identityUser.id); } catch (e) { console.error('Rollback deleteUser failed:', e); }
      await releaseInvite();
      throw err;
    }

    if (invite) {
      await db.sql`UPDATE volunteer_invites SET volunteer_id = ${volunteerId} WHERE id = ${invite.id}`;
    }
    await recordAttempt(db, ip, 'registered');

    // Never fail a registration over an email.
    if (!invite) {
      try {
        await sendPendingEmail(req, { fullName, email });
      } catch (err) {
        console.error('Pending confirmation email failed:', err.message);
      }
    }
    try {
      await notifyAdmin(db, req, { fullName, email, phone }, !!invite);
    } catch (err) {
      console.error('Registration alert email failed:', err.message);
    }

    return reply(200, { success: true, status: approvalStatus, fullName, email });
  } catch (error) {
    console.error('Error registering volunteer:', error);
    return reply(500, { error: 'Something went wrong creating your account. Please try again.' });
  }
};
