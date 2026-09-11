// Scheduled Netlify Function (runs daily via the `config.schedule` cron
// below -- Netlify's scheduler calls this directly; it is NOT reachable by
// a public URL) that emails every volunteer assigned to a shift TODAY
// (Europe/London) a reminder with their route's full street list, via
// Resend. Respects each volunteer's reminder_email_opt_in flag.
//
// Scheduled functions only fire automatically on the site's production
// deploy (not branch deploys/deploy previews), and don't return a response
// body to anything -- so this logs a summary via console.log for
// visibility in the function's logs, and can be tested with the
// "Run now" button on the function's page in the Netlify dashboard, or
// `netlify functions:invoke send-shift-reminders` via the CLI.

import { getDatabase } from '@netlify/database';

const TIME_ZONE = 'Europe/London';
const FROM_ADDRESS = 'Santa Super Sleigh Salford <noreply@santasleighsalford.co.uk>';
const REPLY_TO = 'nathan.talbot@100thsalford.co.uk';

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
    '<h1 style="color:#C41E3A;">🎅 Tonight\'s Santa Sleigh shift</h1>' +
    '<p>Here\'s your shift for tonight:</p>' +
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
  const summary = { todayDate: null, volunteersEmailed: 0, errors: [] };

  try {
    const db = getDatabase();
    const todayDate = londonDateString(new Date());
    summary.todayDate = todayDate;

    const shiftRows = await db.sql`
      SELECT v.id AS volunteer_id, v.email, v.preferred_email, sa.role,
             r.name AS route_name, rd.id AS route_date_id,
             to_char(rd.event_date, 'YYYY-MM-DD') AS event_date
      FROM shift_assignments sa
      JOIN route_dates rd ON sa.route_date_id = rd.id
      JOIN routes r ON rd.route_id = r.id
      JOIN volunteers v ON sa.volunteer_id = v.id
      WHERE rd.event_date = ${todayDate} AND v.reminder_email_opt_in = TRUE
    `;

    if (shiftRows.length === 0) {
      console.log('send-shift-reminders: no shifts today (' + todayDate + '), nothing to send.');
      return;
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
        ? 'Tonight’s shift: ' + shifts[0].routeName
        : 'Tonight’s shifts (' + shifts.length + ')';
      try {
        await sendEmail(toEmail, buildEmailHtml(shifts), subject);
        summary.volunteersEmailed++;
      } catch (err) {
        console.error('Failed to email ' + toEmail + ':', err.message);
        summary.errors.push({ email: toEmail, error: err.message });
      }
    }

    console.log('send-shift-reminders summary:', JSON.stringify(summary));
  } catch (error) {
    console.error('send-shift-reminders fatal error:', error);
  }
};

export const config = {
  // 7:00am UTC, which is 7:00am in Europe/London during December (GMT,
  // no daylight saving offset then) -- the whole event window is in
  // December so this doesn't need DST-aware adjustment.
  schedule: '0 7 * * *'
};
