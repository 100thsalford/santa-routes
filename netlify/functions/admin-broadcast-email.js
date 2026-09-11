// Admin-only custom email broadcast: a free-text subject/message sent
// either to every volunteer, or just the volunteers signed up (any source)
// to one specific route_date. For general announcements (a schedule
// change, a weather cancellation, a reminder to bring something) that
// don't fit the nightly per-shift reminder template in
// send-shift-reminders.js / admin-send-reminders.js. Sends regardless of
// reminder_email_opt_in -- that flag is scoped to the automatic nightly
// shift reminder, not admin-initiated announcements.
//
// POST body: { subject, message, scope: 'all' | 'event', routeDateId? }
// message is plain text; line breaks become <br>, everything else is
// HTML-escaped.

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';

const headers = { 'Content-Type': 'application/json' };
const FROM_ADDRESS = 'Santa Super Sleigh Salford <noreply@santasleighsalford.co.uk>';
const REPLY_TO = 'nathan.talbot@100thsalford.co.uk';

function requireAdmin(user) {
  return !!(user && user.roles && user.roles.includes('admin'));
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
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

async function sendEmail(toEmail, html, subject) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not set');
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      reply_to: REPLY_TO,
      to: [toEmail],
      subject: subject,
      html: html
    })
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error('Resend API error ' + res.status + ': ' + body);
  }
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
    const scope = body.scope === 'event' ? 'event' : 'all';

    if (!subject || !message) {
      return new Response(JSON.stringify({ error: 'subject and message are required' }), { status: 400, headers });
    }
    if (scope === 'event' && !body.routeDateId) {
      return new Response(JSON.stringify({ error: 'routeDateId is required when scope is "event"' }), { status: 400, headers });
    }

    const db = getDatabase();
    let recipientRows;
    if (scope === 'event') {
      recipientRows = await db.sql`
        SELECT DISTINCT v.email, v.preferred_email
        FROM shift_assignments sa
        JOIN volunteers v ON sa.volunteer_id = v.id
        WHERE sa.route_date_id = ${body.routeDateId}
      `;
    } else {
      recipientRows = await db.sql`SELECT email, preferred_email FROM volunteers`;
    }

    const html = buildEmailHtml(message);
    const errors = [];
    let sent = 0;

    for (const row of recipientRows) {
      const toEmail = row.preferred_email || row.email;
      try {
        await sendEmail(toEmail, html, subject);
        sent++;
      } catch (err) {
        console.error('Failed to email ' + toEmail + ':', err.message);
        errors.push({ email: toEmail, error: err.message });
      }
    }

    return new Response(JSON.stringify({ success: true, recipientCount: recipientRows.length, sent, errors }), { status: 200, headers });
  } catch (error) {
    console.error('Error sending broadcast email:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
