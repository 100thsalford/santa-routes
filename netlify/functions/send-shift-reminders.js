// Scheduled Netlify Function (runs daily via the `config.schedule` cron
// below -- Netlify's scheduler calls this directly; it is NOT reachable by
// a public URL) that emails every volunteer assigned to a shift TODAY
// (Europe/London) a reminder with their route's full street list, via
// Resend. Santa / Driver / Safety Walker role holders are included too
// (see lib/shift-reminders.js) and get their role highlighted. Respects each volunteer's reminder_email_opt_in flag.
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
import { loadShiftReminders } from '../lib/shift-reminders.js';

const TIME_ZONE = 'Europe/London';
const PORTAL_URL = 'https://santasleighsalford.co.uk/volunteer.html?login=1';

function londonDateString(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

export default async (req, context) => {
  const summary = { todayDate: null, volunteersEmailed: 0, roleHoldersEmailed: 0, errors: [] };

  try {
    const db = getDatabase();
    const todayDate = londonDateString(new Date());
    summary.todayDate = todayDate;

    const reminders = await loadShiftReminders(db, todayDate);

    if (reminders.length === 0) {
      console.log('send-shift-reminders: no shifts today (' + todayDate + '), nothing to send.');
      return;
    }

    for (const { toEmail, shifts, todo } of reminders) {
      if (!toEmail) continue; // e.g. a guest volunteer with no email on file
      const { subject, html } = shiftReminderEmail(shifts, { portalUrl: PORTAL_URL, tonight: true, todo });
      try {
        await sendEmail({ to: toEmail, subject, html });
        summary.volunteersEmailed++;
        if (shifts.some((s) => s.eventRoles.length)) summary.roleHoldersEmailed++;
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
