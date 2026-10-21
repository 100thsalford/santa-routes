// Admin-only branded volunteer invites. Sends a Santa Sleigh email (via
// Resend, not Netlify's plain invite email) with a one-time link to the
// helpout page; whoever registers through it skips the sign-up code and is
// approved straight away (see helpout-register.js).
//
// POST body:
//   { op: 'invite', fullName, email }
//   { op: 'resend', inviteId }   -- new link + fresh 14-day expiry
//   { op: 'cancel', inviteId }
//
// Only a hash of each token is stored, so "resend" issues a new token
// rather than re-sending the old one.

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { createHash, randomBytes } from 'node:crypto';
import { brandedEmailHtml, escapeHtml, sendEmail, siteUrls } from '../lib/email.js';

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_DAYS = 14;

function requireAdmin(user) {
  return !!(user && user.roles && user.roles.includes('admin'));
}

function newToken() {
  const token = randomBytes(24).toString('base64url');
  return { token, hash: createHash('sha256').update(token).digest('hex') };
}

async function sendInviteEmail(req, { email, fullName, token, expiresAt }) {
  const link = siteUrls(req).helpout + '?invite=' + encodeURIComponent(token);
  const expiry = new Date(expiresAt).toLocaleDateString('en-GB', {
    timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long'
  });
  const greeting = fullName ? 'Hi ' + escapeHtml(fullName.split(' ')[0]) + ',' : 'Hi,';
  const html = brandedEmailHtml({
    heading: "You're invited to join the Santa Sleigh team",
    paragraphs: [
      greeting,
      'Every December the 100th Salford Scout Group takes Santa\'s sleigh around the streets of Salford, and we\'d love you to help make it happen.',
      'Click below to create your volunteer account. Once you\'re in, you can see the nights we\'re out and sign up for the ones that suit you.'
    ],
    button: { label: 'Create my volunteer account', url: link },
    footnote: 'This link is personal to you, works once and expires on ' + escapeHtml(expiry) + '. ' +
      'Not expecting this? You can safely ignore it, or reply and let us know.'
  });
  await sendEmail({ to: email, subject: "You're invited to help Santa's sleigh this Christmas 🎅", html });
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
    const db = getDatabase();
    const reply = (status, data) => new Response(JSON.stringify(data), { status, headers });

    if (body.op === 'cancel') {
      await db.sql`UPDATE volunteer_invites SET cancelled_at = NOW() WHERE id = ${body.inviteId} AND used_at IS NULL`;
      return reply(200, { success: true });
    }

    if (body.op === 'resend') {
      const { token, hash } = newToken();
      const rows = await db.sql`
        UPDATE volunteer_invites
        SET token_hash = ${hash}, expires_at = NOW() + ${INVITE_DAYS + ' days'}::interval, cancelled_at = NULL
        WHERE id = ${body.inviteId} AND used_at IS NULL
        RETURNING email, full_name, expires_at
      `;
      if (rows.length === 0) return reply(404, { error: 'Invite not found, or already used' });
      await sendInviteEmail(req, { email: rows[0].email, fullName: rows[0].full_name, token, expiresAt: rows[0].expires_at });
      return reply(200, { success: true });
    }

    // op: 'invite'
    const fullName = String(body.fullName || '').trim().slice(0, 100);
    const email = String(body.email || '').trim().toLowerCase();
    if (!fullName) return reply(400, { error: 'A name is required' });
    if (!EMAIL_RE.test(email)) return reply(400, { error: 'A valid email address is required' });

    const existing = await db.sql`
      SELECT id FROM volunteers
      WHERE identity_user_id IS NOT NULL AND (LOWER(email) = ${email} OR LOWER(preferred_email) = ${email})
    `;
    if (existing.length > 0) {
      return reply(409, { error: email + ' already has a volunteer account' });
    }

    // One live invite per address: a new invite replaces any older unused one.
    await db.sql`
      UPDATE volunteer_invites SET cancelled_at = NOW()
      WHERE LOWER(email) = ${email} AND used_at IS NULL AND cancelled_at IS NULL
    `;

    const { token, hash } = newToken();
    const rows = await db.sql`
      INSERT INTO volunteer_invites (token_hash, email, full_name, invited_by, expires_at)
      VALUES (${hash}, ${email}, ${fullName}, ${user.email || null}, NOW() + ${INVITE_DAYS + ' days'}::interval)
      RETURNING id, expires_at
    `;

    try {
      await sendInviteEmail(req, { email, fullName, token, expiresAt: rows[0].expires_at });
    } catch (err) {
      await db.sql`DELETE FROM volunteer_invites WHERE id = ${rows[0].id}`;
      throw err;
    }

    return reply(200, { success: true, inviteId: rows[0].id });
  } catch (error) {
    console.error('Error sending volunteer invite:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
