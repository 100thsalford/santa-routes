// Shared "your shift tonight" reminder email, used by both the scheduled
// 7am job (send-shift-reminders.js) and the admin "Send tonight's
// reminders now" button (admin-send-reminders.js), in the same Santa
// Sleigh branded template as the registration emails (lib/email.js).

import { brandedEmailHtml, escapeHtml } from './email.js';

function formatDateLabel(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

function shiftCardHtml(shift) {
  const streetRows = shift.streets.map(function(s, i) {
    const bg = i % 2 === 0 ? '#ffffff' : '#F6F4F0';
    return '<tr style="background:' + bg + ';">' +
      '<td width="96" style="width:96px; padding:8px 10px; font-size:14px; color:#5B6169; white-space:nowrap; vertical-align:top;">' + escapeHtml(s.timeRange || '') + '</td>' +
      '<td style="padding:8px 10px; font-size:15px; color:#24272E;">' + escapeHtml(s.name) + '</td>' +
      '</tr>';
  }).join('');

  const role = shift.role
    ? ' <span style="display:inline-block; margin-left:6px; padding:2px 10px; border-radius:999px; background:#1E5B45; color:#ffffff; font-size:12px; font-weight:bold; vertical-align:middle;">' + escapeHtml(shift.role) + '</span>'
    : '';

  const streets = streetRows
    ? '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse; width:100%; border-top:1px solid #E7E2D9;">' + streetRows + '</table>'
    : '<p style="margin:0; padding:12px 14px; font-size:14px; color:#5B6169; border-top:1px solid #E7E2D9;">The street list for this route hasn\'t been added yet.</p>';

  return (
    '<div style="border:1px solid #E7E2D9; border-radius:12px; overflow:hidden; margin:0 0 20px;">' +
      '<div style="padding:14px 14px 12px;">' +
        '<div style="font-size:17px; font-weight:bold; color:#1E5B45;">' + escapeHtml(shift.routeName) + role + '</div>' +
        '<div style="font-size:14px; color:#5B6169; margin-top:4px;">' + escapeHtml(formatDateLabel(shift.eventDate)) + '</div>' +
      '</div>' +
      streets +
    '</div>'
  );
}

// shifts: [{ routeName, eventDate, role, streets: [{ name, timeRange }] }]
// options.tonight: true for the 7am same-day reminder.
export function shiftReminderEmail(shifts, { portalUrl, tonight }) {
  const many = shifts.length > 1;
  const heading = tonight
    ? (many ? "Your Santa Sleigh shifts tonight" : "Your Santa Sleigh shift tonight")
    : (many ? "Your Santa Sleigh shifts" : "Your Santa Sleigh shift");
  const routes = many ? 'Here are your routes' : "Here's your route";
  const intro = (tonight ? 'Thanks for helping tonight! ' + routes : routes) +
    " and the streets we'll be visiting, in order.";

  const html = brandedEmailHtml({
    heading,
    paragraphs: [intro],
    bodyHtml: shifts.map(shiftCardHtml).join(''),
    button: { label: 'Open the volunteer portal', url: portalUrl },
    footnote: "Meeting point, gathering time and the route map are in the volunteer portal. " +
      "You're getting this because you're signed up to help Santa Super Sleigh Salford; you can turn these reminders off from the portal at any time."
  });

  const subject = tonight
    ? (many ? 'Tonight’s shifts (' + shifts.length + ')' : 'Tonight’s shift: ' + shifts[0].routeName) + ' 🎅'
    : (many ? 'Shift reminders (' + shifts.length + ')' : 'Shift reminder: ' + shifts[0].routeName) + ' 🎅';

  return { subject, html };
}
