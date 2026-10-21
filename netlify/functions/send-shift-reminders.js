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
import { sendEmail } from '../lib/email.js';
import { shiftReminderEmail } from '../lib/shift-reminder-email.js';

const TIME_ZONE = 'Europe/London';
const PORTAL_URL = 'https://santasleighsalford.co.uk/volunteer.html?login=1';

function londonDateString(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

export default async (req, context) => {
  const summary = { todayDate: null, volunteersEmailed: 0, errors: [] };

  try {
    const db = getDatabase();
    const todayDate = londonDateString(new Date());
    summary.todayDate = todayDate;

    const shiftRows = await db.sql`
      SELECT v.id AS volunteer_id, v.email, v.preferred_email, sa.role,
             CASE WHEN COALESCE(TRIM(r.internal_name), '') <> '' THEN r.name || ' — ' || TRIM(r.internal_name) ELSE r.name END AS route_name, rd.id AS route_date_id,
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
      if (!toEmail) continue; // e.g. a guest volunteer with no email on file
      const { subject, html } = shiftReminderEmail(shifts, { portalUrl: PORTAL_URL, tonight: true });
      try {
        await sendEmail({ to: toEmail, subject, html });
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
