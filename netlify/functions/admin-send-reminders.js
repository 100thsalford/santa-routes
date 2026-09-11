// Admin-triggered version of send-shift-reminders.js's scheduled job --
// lets an admin fire off "tonight's shift reminders" on demand from
// admin.html instead of only via the Netlify dashboard's "Run now" button
// on the scheduled function (which isn't reachable from the site itself
// and isn't admin-role gated). Deliberately duplicates the scheduled
// function's query/email-building logic rather than importing it, per
// this codebase's per-function self-contained-helpers convention -- also
// lets this one return a JSON summary to the caller, which a scheduled
// function can't do.
//
// POST body: { date?: 'YYYY-MM-DD' } -- defaults to today (Europe/London).

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';

const headers = { 'Content-Type': 'application/json' };
const TIME_ZONE = 'Europe/London';
const FROM_ADDRESS = 'Santa Super Sleigh Salford <noreply@santasleighsalford.co.uk>';
const REPLY_TO = 'nathan.talbot@100thsalford.co.uk';

function requireAdmin(user) {
  return !!(user && user.roles && user.roles.includes('admin'));
}

function londonDateString(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

function formatDateLabel(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function buildEmailHtml(volunteerShifts) {
  const sections = volunteerShifts.map(function(shift) {
    const streetRows = shift.streets.map(function(s) {
      return '<tr>' +
        '<td style="padding:4px 8px; color:#666;">' + escapeHtml(s.timeRange || '') + '</td>' +
        '<td style="padding:4px 8px;">' + escapeHtml(s.name) + '</td>' +
        '</tr>';
    }).join('');

    return (
      '<h2 style="color:#165B33; margin:1.5rem 0 0.5rem;">' + escapeHtml(shift.routeName) +
      (shift.role ? ' (' + escapeHtml(shift.role) + ')' : '') + '</h2>' +
      '<p style="margin:0 0 0.75rem;">' + escapeHtml(formatDateLabel(shift.eventDate)) + '</p>' +
      '<table style="border-collapse:collapse; width:100%; max-width:480px;">' + streetRows + '</table>'
    );
  }).join('<hr style="margin:1.5rem 0; border:none; border-top:1px solid #eee;">');

  return (
    '<div style="font-family: sans-serif; color:#212529;">' +
    '<h1 style="color:#C41E3A;">🎅 Your Santa Sleigh shift</h1>' +
    '<p>Here\'s your shift:</p>' +
    sections +
    '<p style="margin-top:2rem; color:#777; font-size:0.9rem;">' +
    'You\'re receiving this because you\'re signed up to volunteer for Santa Super Sleigh Salford. ' +
    'You can turn off these reminders any time from the <a href="https://santasleighsalford.co.uk/volunteer.html">volunteer portal</a>.' +
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

    const body = await req.json().catch(function() { return {}; });
    const targetDate = (body && body.date) || londonDateString(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      return new Response(JSON.stringify({ error: 'date must be YYYY-MM-DD' }), { status: 400, headers });
    }

    const db = getDatabase();
    const summary = { date: targetDate, volunteersEmailed: 0, errors: [] };

    const shiftRows = await db.sql`
      SELECT v.id AS volunteer_id, v.email, v.preferred_email, sa.role,
             r.name AS route_name, rd.id AS route_date_id,
             to_char(rd.event_date, 'YYYY-MM-DD') AS event_date
      FROM shift_assignments sa
      JOIN route_dates rd ON sa.route_date_id = rd.id
      JOIN routes r ON rd.route_id = r.id
      JOIN volunteers v ON sa.volunteer_id = v.id
      WHERE rd.event_date = ${targetDate} AND v.reminder_email_opt_in = TRUE
    `;

    if (shiftRows.length === 0) {
      return new Response(JSON.stringify(Object.assign({ success: true }, summary)), { status: 200, headers });
    }

    const routeDateIds = Array.from(new Set(shiftRows.map((r) => r.route_date_id)));
    const streetRows = await db.sql`
      SELECT route_date_id, sequence, name, time_range
      FROM streets WHERE route_date_id = ANY(${routeDateIds})
      ORDER BY route_date_id, sequence
    `;
    const streetsByDate = {};
    for (const s of streetRows) {
      (streetsByDate[s.route_date_id] = streetsByDate[s.route_date_id] || []).push({
        name: s.name, timeRange: s.time_range
      });
    }

    const shiftsByVolunteer = {};
    for (const row of shiftRows) {
      const toEmail = row.preferred_email || row.email;
      const key = row.volunteer_id;
      if (!shiftsByVolunteer[key]) shiftsByVolunteer[key] = { toEmail, shifts: [] };
      shiftsByVolunteer[key].shifts.push({
        routeName: row.route_name,
        eventDate: row.event_date,
        role: row.role,
        streets: streetsByDate[row.route_date_id] || []
      });
    }

    for (const volunteerId of Object.keys(shiftsByVolunteer)) {
      const { toEmail, shifts } = shiftsByVolunteer[volunteerId];
      const subject = shifts.length === 1
        ? 'Shift reminder: ' + shifts[0].routeName
        : 'Shift reminders (' + shifts.length + ')';
      try {
        await sendEmail(toEmail, buildEmailHtml(shifts), subject);
        summary.volunteersEmailed++;
      } catch (err) {
        console.error('Failed to email ' + toEmail + ':', err.message);
        summary.errors.push({ email: toEmail, error: err.message });
      }
    }

    return new Response(JSON.stringify(Object.assign({ success: true }, summary)), { status: 200, headers });
  } catch (error) {
    console.error('Error sending manual reminders:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
