// Shared "your shift tonight" reminder email, used by both the scheduled
// 7am job (send-shift-reminders.js) and the admin "Send tonight's
// reminders now" button (admin-send-reminders.js), in the same Santa
// Sleigh branded template as the registration emails (lib/email.js).
//
// Volunteers holding a special role (Santa / Driver / Safety Walker, from
// event_role_assignments) get a highlighted banner at the very top of the
// email, the role in the subject line, and a role pill on that route's card.

import { brandedEmailHtml, escapeHtml } from './email.js';
import { EVENT_ROLE_LABELS } from './shift-reminders.js';

const EVENT_ROLE_ICONS = { santa: '🎅', driver: '🚐', safety_walker: '🦺' };

function formatDateLabel(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  });
}

function shortDateLabel(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long'
  });
}

function joinWords(words) {
  if (words.length <= 1) return words.join('');
  return words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1];
}

function pill(text, bg) {
  return ' <span style="display:inline-block; margin-left:6px; padding:2px 10px; border-radius:999px; background:' + bg + '; color:#ffffff; font-size:12px; font-weight:bold; vertical-align:middle;">' + escapeHtml(text) + '</span>';
}

function shiftCardHtml(shift) {
  const streetRows = shift.streets.map(function(s, i) {
    const bg = i % 2 === 0 ? '#ffffff' : '#F6F4F0';
    return '<tr style="background:' + bg + ';">' +
      '<td width="96" style="width:96px; padding:8px 10px; font-size:14px; color:#5B6169; white-space:nowrap; vertical-align:top;">' + escapeHtml(s.timeRange || '') + '</td>' +
      '<td style="padding:8px 10px; font-size:15px; color:#24272E;">' + escapeHtml(s.name) + '</td>' +
      '</tr>';
  }).join('');

  const eventRoles = shift.eventRoles || [];
  const rolePills = eventRoles.length
    ? eventRoles.map(function(r) { return pill(EVENT_ROLE_ICONS[r] + ' ' + EVENT_ROLE_LABELS[r], '#A8382F'); }).join('')
    : (shift.role ? pill(shift.role, '#1E5B45') : '');

  const streets = streetRows
    ? '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse; width:100%; border-top:1px solid #E7E2D9;">' + streetRows + '</table>'
    : '<p style="margin:0; padding:12px 14px; font-size:14px; color:#5B6169; border-top:1px solid #E7E2D9;">The street list for this route hasn\'t been added yet.</p>';

  return (
    '<div style="border:1px solid #E7E2D9; border-radius:12px; overflow:hidden; margin:0 0 20px;">' +
      '<div style="padding:14px 14px 12px;">' +
        '<div style="font-size:17px; font-weight:bold; color:#1E5B45;">' + escapeHtml(shift.routeName) + rolePills + '</div>' +
        '<div style="font-size:14px; color:#5B6169; margin-top:4px;">' + escapeHtml(formatDateLabel(shift.eventDate)) + '</div>' +
      '</div>' +
      streets +
    '</div>'
  );
}

// One banner line per (route, role) the volunteer holds that night.
function roleBannerHtml(shifts, tonight) {
  const lines = [];
  for (const shift of shifts) {
    for (const r of shift.eventRoles || []) {
      const when = tonight ? 'tonight' : 'on ' + shortDateLabel(shift.eventDate);
      lines.push(
        '<div style="font-size:20px; font-weight:bold; color:#A8382F; line-height:1.35;">' +
          EVENT_ROLE_ICONS[r] + '&nbsp; You\'re ' + (r === 'santa' ? '' : 'the ') + escapeHtml(EVENT_ROLE_LABELS[r]) + ' ' + escapeHtml(when) +
        '</div>' +
        '<div style="font-size:15px; color:#24272E; margin:2px 0 10px;">on ' + escapeHtml(shift.routeName) + '</div>'
      );
    }
  }
  if (!lines.length) return '';
  return (
    '<div style="margin:0 0 20px; padding:16px 16px 6px; background:#FBECEA; border:2px solid #A8382F; border-radius:12px;">' +
      lines.join('') +
      '<p style="margin:0 0 10px; font-size:14px; line-height:1.5; color:#24272E;">The team is counting on you for this role. If anything changes and you can\'t make it, please let us know as soon as possible so we can find cover.</p>' +
    '</div>'
  );
}

// shifts: [{ routeName, eventDate, role, eventRoles, streets: [{ name, timeRange }] }]
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
    bodyHtml: roleBannerHtml(shifts, tonight) + shifts.map(shiftCardHtml).join(''),
    button: { label: 'Open the volunteer portal', url: portalUrl },
    footnote: "Meeting point, gathering time and the route map are in the volunteer portal. " +
      "You're getting this because you're signed up to help Santa Super Sleigh Salford; you can turn these reminders off from the portal at any time."
  });

  // Role(s) lead the subject so they show in the inbox preview.
  const roleKeys = [];
  for (const s of shifts) for (const r of s.eventRoles || []) if (!roleKeys.includes(r)) roleKeys.push(r);
  const roleText = roleKeys.length
    ? "you're " + joinWords(roleKeys.map(function(r) { return (r === 'santa' ? '' : 'the ') + EVENT_ROLE_LABELS[r]; }))
    : '';

  let subject;
  if (tonight) {
    subject = roleText
      ? 'Tonight ' + roleText + ': ' + (many ? shifts.length + ' routes' : shifts[0].routeName)
      : (many ? 'Tonight’s shifts (' + shifts.length + ')' : 'Tonight’s shift: ' + shifts[0].routeName);
  } else {
    subject = roleText
      ? 'Shift reminder (' + roleText + '): ' + (many ? shifts.length + ' routes' : shifts[0].routeName)
      : (many ? 'Shift reminders (' + shifts.length + ')' : 'Shift reminder: ' + shifts[0].routeName);
  }
  subject += ' 🎅';

  return { subject, html };
}
