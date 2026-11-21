// Admin-only custom email broadcast: a free-text subject/message sent to
// every volunteer, the volunteers signed up (any source) to one specific
// route_date, or the volunteers with nothing booked on any upcoming night.
// For general announcements (a schedule
// change, a weather cancellation, a reminder to bring something) that
// don't fit the nightly per-shift reminder template in
// send-shift-reminders.js / admin-send-reminders.js. Sends regardless of
// reminder_email_opt_in -- that flag is scoped to the automatic nightly
// shift reminder, not admin-initiated announcements.
//
// POST body: { subject, message, scope: 'all' | 'event' | 'no_upcoming', routeDateId?, pushText? }
// message is plain text; line breaks become <br>, everything else is
// HTML-escaped. pushText (optional) also sends a push notification --
// subject as its title, pushText as its body -- to every recipient who has
// notifications on (lib/push.js). Audiences: lib/broadcast-audience.js.
//
// { scope, preview: true } sends nothing and returns who would receive it.
//

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { escapeHtml, sendEmail } from '../lib/email.js';
import { SCOPES, displayName, findRecipients } from '../lib/broadcast-audience.js';
import { BODY_MAX, pushConfigured, sendPushToVolunteers } from '../lib/push.js';

const headers = { 'Content-Type': 'application/json' };

function requireAdmin(user) {
  return !!(user && user.roles && user.roles.includes('admin'));
}

function messageToHtml(message) {
  return escapeHtml(message).replace(/\n/g, '<br>');
}

function buildEmailHtml(message) {
  return (
    '<div style="font-family: sans-serif; color:#212529;">' +
    '<h1 style="color:#C41E3A;">🎅 A message from Santa Super Sleigh Salford</h1>' +
    '<p>' + messageToHtml(message) + '</p>' +
    '<p style="margin-top:2rem; color:#777; font-size:0.9rem;">' +
    'You\'re receiving this because you\'re a volunteer for Santa Super Sleigh Salford. ' +
    'Manage your account from the <a href="https://santasleighsalford.co.uk/volunteer.html">volunteer portal</a>.' +
    '</p>' +
    '</div>'
  );
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
    const subject = (body.subject || '').trim();
    const message = (body.message || '').trim();
    const scope = body.scope;
    const preview = body.preview === true;
    const pushText = typeof body.pushText === 'string' ? body.pushText.trim() : '';

    // An unrecognised scope must never fall through to emailing everyone.
    if (!SCOPES.includes(scope)) {
      return new Response(JSON.stringify({ error: 'Unknown scope' }), { status: 400, headers });
    }
    if (!preview && (!subject || !message)) {
      return new Response(JSON.stringify({ error: 'subject and message are required' }), { status: 400, headers });
    }
    if (pushText.length > BODY_MAX) {
      return new Response(JSON.stringify({ error: 'Push text must be ' + BODY_MAX + ' characters or fewer' }), { status: 400, headers });
    }
    if (pushText && !pushConfigured()) {
      return new Response(JSON.stringify({ error: "Push notifications aren't set up yet (VAPID keys missing) -- clear the push text to send email only." }), { status: 400, headers });
    }
    if (scope === 'event' && !body.routeDateId) {
      return new Response(JSON.stringify({ error: 'routeDateId is required when scope is "event"' }), { status: 400, headers });
    }

    const db = getDatabase();
    const recipientRows = await findRecipients(db, scope, body.routeDateId);

    if (preview) {
      return new Response(JSON.stringify({
        success: true,
        recipientCount: recipientRows.length,
        names: recipientRows.map(displayName)
      }), { status: 200, headers });
    }

    const html = buildEmailHtml(message);
    const errors = [];
    let sent = 0;

    for (const row of recipientRows) {
      const toEmail = row.preferred_email || row.email;
      if (!toEmail) continue; // e.g. a guest volunteer with no email on file
      try {
        await sendEmail({ to: toEmail, subject, html });
        sent++;
      } catch (err) {
        console.error('Failed to email ' + toEmail + ':', err.message);
        errors.push({ email: toEmail, error: err.message });
      }
    }

    let push = null;
    if (pushText) {
      try {
        push = await sendPushToVolunteers(db, recipientRows.map((r) => r.id),
          { title: subject, body: pushText, url: '/volunteer.html', tag: 'broadcast-' + Date.now() },
          { ttl: 24 * 3600, urgency: 'normal' });
      } catch (err) {
        console.error('Broadcast push failed:', err);
        push = { error: err.message };
      }
    }

    return new Response(JSON.stringify({ success: true, recipientCount: recipientRows.length, sent, errors, push }), { status: 200, headers });
  } catch (error) {
    console.error('Error sending broadcast email:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
