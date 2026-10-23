// Serves a single-event calendar file (.ics) for a volunteer shift, built
// purely from the query string -- it reads no database and exposes nothing
// the caller didn't already supply. It exists because iPhone browsers
// handle calendar files unreliably when they're generated in the page
// (blob: / data: URLs): Chrome and others simply do nothing. A normal https
// URL that answers with text/calendar is opened by iOS's Add to Calendar
// sheet in Safari, and can be handed to the Calendar app via webcal://.
//
// Query: d=YYYY-MM-DD  s=HH:MM  e=HH:MM  t=title  desc=description
//        loc=location  uid=unique id (optional)
// Times are Europe/London wall-clock times.

const MAX_TEXT = 600;

function clean(v, max) {
  return String(v || '').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').slice(0, max || MAX_TEXT);
}

function esc(s) {
  return s.replace(/[\\;,]/g, function (c) { return '\\' + c; }).replace(/\r?\n/g, '\\n');
}

// RFC 5545 says lines over 75 octets should be folded.
function fold(line) {
  const out = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 74) {
    let cut = 74;
    while (Buffer.byteLength(rest.slice(0, cut)) > 74) cut--;
    out.push(rest.slice(0, cut));
    rest = ' ' + rest.slice(cut);
  }
  out.push(rest);
  return out.join('\r\n');
}

const VTIMEZONE = [
  'BEGIN:VTIMEZONE',
  'TZID:Europe/London',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0000',
  'TZOFFSETTO:+0100',
  'TZNAME:BST',
  'DTSTART:19700329T010000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0000',
  'TZNAME:GMT',
  'DTSTART:19701025T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE'
];

export default async function handler(request) {
  const q = new URL(request.url).searchParams;
  const d = q.get('d') || '';
  const s = q.get('s') || '17:00';
  const e = q.get('e') || '22:00';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(s) || !/^\d{2}:\d{2}$/.test(e)) {
    return new Response('Bad calendar request', { status: 400 });
  }
  const compact = function (date, time) { return date.replace(/-/g, '') + 'T' + time.replace(':', '') + '00'; };
  const stamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const uid = clean(q.get('uid') || ('shift-' + d), 80).replace(/[^A-Za-z0-9@._-]/g, '') || ('shift-' + d);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Santa Super Sleigh Salford//Volunteer Portal//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH'
  ].concat(VTIMEZONE, [
    'BEGIN:VEVENT',
    'UID:' + uid + '@santasleighsalford.co.uk',
    'DTSTAMP:' + stamp,
    'DTSTART;TZID=Europe/London:' + compact(d, s),
    'DTEND;TZID=Europe/London:' + compact(d, e),
    'SUMMARY:' + esc(clean(q.get('t'), 200)),
    'DESCRIPTION:' + esc(clean(q.get('desc'))),
    'LOCATION:' + esc(clean(q.get('loc'), 200)),
    'END:VEVENT',
    'END:VCALENDAR'
  ]);

  return new Response(lines.map(fold).join('\r\n') + '\r\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="santa-sleigh-' + d + '.ics"',
      'Cache-Control': 'no-store'
    }
  });
}
