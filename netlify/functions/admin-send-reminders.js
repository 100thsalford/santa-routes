// Admin-triggered version of send-shift-reminders.js's scheduled job --
// lets an admin fire off "tonight's shift reminders" on demand from
// admin.html instead of only via the Netlify dashboard's "Run now" button
// on the scheduled function (which isn't reachable from the site itself
// and isn't admin-role gated). Shares the scheduled function's recipient
// query (lib/shift-reminders.js) and email template
// (lib/shift-reminder-email.js), but returns a JSON summary to the caller,
// which a scheduled function can't do.
//
// POST body: { date?: 'YYYY-MM-DD' } -- defaults to today (Europe/London).

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { sendEmail, siteUrls } from '../lib/email.js';
import { shiftReminderEmail } from '../lib/shift-reminder-email.js';
import { loadShiftReminders } from '../lib/shift-reminders.js';

const headers = { 'Content-Type': 'application/json' };
const TIME_ZONE = 'Europe/London';
function requireAdmin(user) {
  return !!(user && user.roles && user.roles.includes('admin'));
}

function londonDateString(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
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
    const summary = { date: targetDate, volunteersEmailed: 0, roleHoldersEmailed: 0, errors: [] };

    const reminders = await loadShiftReminders(db, targetDate);

    const portalUrl = siteUrls(req).volunteerLogin;
    const isToday = targetDate === londonDateString(new Date());
    for (const { toEmail, shifts } of reminders) {
      if (!toEmail) continue; // e.g. a guest volunteer with no email on file
      const { subject, html } = shiftReminderEmail(shifts, { portalUrl, tonight: isToday });
      try {
        await sendEmail({ to: toEmail, subject, html });
        summary.volunteersEmailed++;
        if (shifts.some((s) => s.eventRoles.length)) summary.roleHoldersEmailed++;
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
