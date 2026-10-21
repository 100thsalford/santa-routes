// Admin-triggered version of send-shift-reminders.js's scheduled job --
// lets an admin fire off "tonight's shift reminders" on demand from
// admin.html instead of only via the Netlify dashboard's "Run now" button
// on the scheduled function (which isn't reachable from the site itself
// and isn't admin-role gated). Duplicates the scheduled function's query
// (so this one can return a JSON summary to the caller, which a scheduled
// function can't do) but shares its email template via
// lib/shift-reminder-email.js.
//
// POST body: { date?: 'YYYY-MM-DD' } -- defaults to today (Europe/London).

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { sendEmail, siteUrls } from '../lib/email.js';
import { shiftReminderEmail } from '../lib/shift-reminder-email.js';

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
    const summary = { date: targetDate, volunteersEmailed: 0, errors: [] };

    const shiftRows = await db.sql`
      SELECT v.id AS volunteer_id, v.email, v.preferred_email, sa.role,
             CASE WHEN COALESCE(TRIM(r.internal_name), '') <> '' THEN r.name || ' — ' || TRIM(r.internal_name) ELSE r.name END AS route_name, rd.id AS route_date_id,
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

    const portalUrl = siteUrls(req).volunteerLogin;
    const isToday = targetDate === londonDateString(new Date());
    for (const volunteerId of Object.keys(shiftsByVolunteer)) {
      const { toEmail, shifts } = shiftsByVolunteer[volunteerId];
      if (!toEmail) continue; // e.g. a guest volunteer with no email on file
      const { subject, html } = shiftReminderEmail(shifts, { portalUrl, tonight: isToday });
      try {
        await sendEmail({ to: toEmail, subject, html });
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
