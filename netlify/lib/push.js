// Web push notifications for the volunteer portal app.
//
// Volunteers turn notifications on per device from the portal's
// "Get the app" / "Alerts" dialog (functions/push-subscription.js), which
// stores the browser's push subscription in push_subscriptions. This file
// sends to those devices: the daily shift reminder (alongside the email),
// admin broadcasts with push text, and the admin "send push now" panel.
//
// Needs VAPID keys in the Netlify environment (server-side only):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY  -- generate once with
//     npx web-push generate-vapid-keys
//   VAPID_SUBJECT (optional)            -- contact for the push services,
//     defaults to mailto:REPLY_TO
// Changing the keys invalidates every existing subscription, so set them
// once and leave them. With no keys, push is simply switched off: the
// portal hides the notification option and senders skip it.

import webpush from 'web-push';
import { REPLY_TO } from './email.js';

export const TITLE_MAX = 60;
export const BODY_MAX = 180;

// Push services we'll send to. A subscription endpoint is a URL the
// browser gives us; checking the host stops anyone registering an
// arbitrary URL for our server to POST to.
const PUSH_HOST_SUFFIXES = [
  '.push.apple.com',        // Safari / iOS / macOS
  'fcm.googleapis.com',     // Chrome, Edge (Android), Samsung Internet
  '.googleapis.com',
  '.push.services.mozilla.com',
  'push.services.mozilla.com',
  '.notify.windows.com'     // Edge on Windows
];

let configuredWith = null;

export function pushConfigured() {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

export function vapidPublicKey() {
  return process.env.VAPID_PUBLIC_KEY || null;
}

function ensureVapid() {
  const key = process.env.VAPID_PUBLIC_KEY + '|' + process.env.VAPID_PRIVATE_KEY;
  if (configuredWith === key) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || ('mailto:' + REPLY_TO),
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  configuredWith = key;
}

// ---- Pure helpers (exported for tests) ----

export function isAllowedEndpoint(endpoint) {
  if (typeof endpoint !== 'string' || endpoint.length > 1000) return false;
  let u;
  try { u = new URL(endpoint); } catch (e) { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  return PUSH_HOST_SUFFIXES.some((s) => s.startsWith('.') ? host.endsWith(s) : host === s || host.endsWith('.' + s));
}

// Validates a PushSubscription.toJSON() from the browser.
export function cleanSubscription(sub) {
  if (!sub || typeof sub !== 'object') return null;
  const keys = sub.keys || {};
  const b64url = /^[A-Za-z0-9_-]+={0,2}$/;
  if (!isAllowedEndpoint(sub.endpoint)) return null;
  if (typeof keys.p256dh !== 'string' || !b64url.test(keys.p256dh) || keys.p256dh.length > 200) return null;
  if (typeof keys.auth !== 'string' || !b64url.test(keys.auth) || keys.auth.length > 100) return null;
  return { endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

export function clampText(str, max) {
  const s = String(str == null ? '' : str).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

// Only same-site paths -- a notification must never open another site.
export function safePath(path) {
  return (typeof path === 'string' && /^\/(?!\/)/.test(path)) ? path : '/volunteer.html';
}

export function buildPayload({ title, body, url, tag }) {
  return {
    title: clampText(title, TITLE_MAX) || 'Santa Super Sleigh Salford',
    body: clampText(body, BODY_MAX),
    url: safePath(url),
    tag: tag ? String(tag).slice(0, 64) : undefined
  };
}

const ROLE_LINES = {
  santa: "You're Santa tonight! 🎅",
  driver: "You're driving the sleigh tonight.",
  safety_walker: "You're Safety Walker tonight."
};

function shortDate(iso) {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC'
  });
}

// The daily shift reminder as a notification. shifts: as returned by
// loadShiftReminders(). tonight: false when an admin sends for another date.
export function reminderPushContent(shifts, tonight) {
  const first = shifts[0];
  const when = tonight ? 'tonight' : shortDate(first.eventDate);
  const title = shifts.length === 1
    ? (tonight ? "🎅 You're on tonight: " : '🎅 Reminder ' + when + ': ') + first.routeName
    : "🎅 You're on " + shifts.length + ' routes ' + when;

  const bits = [];
  const roles = [];
  shifts.forEach((s) => (s.eventRoles || []).forEach((r) => { if (ROLE_LINES[r] && !roles.includes(r)) roles.push(r); }));
  if (roles.length && tonight) bits.push(ROLE_LINES[roles[0]]);
  if (first.gatheringTime) bits.push('Gather ' + first.gatheringTime + (first.what3words ? ' at ///' + first.what3words : '') + '.');
  else if (first.what3words) bits.push('Meet at ///' + first.what3words + '.');
  bits.push('Tap for your streets and map.');

  return buildPayload({
    title,
    body: bits.join(' '),
    url: '/volunteer.html?login=1&show=schedule',
    tag: 'shift-reminder-' + first.eventDate
  });
}

// ---- Sending ----

// Sends one payload to every device of the given volunteers. Expired
// subscriptions are deleted. Never throws for a single failed device.
// options: { ttl (seconds), urgency: 'normal'|'high' }
// Returns { volunteersReached, devicesSent, devicesFailed, devicesRemoved }.
export async function sendPushToVolunteers(db, volunteerIds, payload, options) {
  const summary = { volunteersReached: 0, devicesSent: 0, devicesFailed: 0, devicesRemoved: 0 };
  const ids = Array.from(new Set((volunteerIds || []).filter((id) => Number.isInteger(id))));
  if (!pushConfigured() || ids.length === 0) return summary;
  const subs = await db.sql`
    SELECT id, volunteer_id, endpoint, p256dh, auth FROM push_subscriptions
    WHERE volunteer_id = ANY(${ids})
  `;
  return sendToSubscriptions(db, subs, payload, options, summary);
}

// Same, for specific push_subscriptions rows (e.g. the "send a test" button).
export async function sendToSubscriptions(db, subs, payload, options, summary) {
  summary = summary || { volunteersReached: 0, devicesSent: 0, devicesFailed: 0, devicesRemoved: 0 };
  if (!pushConfigured() || !subs.length) return summary;
  ensureVapid();
  const opts = options || {};
  const body = JSON.stringify(buildPayload(payload));
  const reached = new Set();
  const ok = [];
  const gone = [];

  // A few at a time so a big send doesn't open dozens of connections at once.
  const BATCH = 10;
  for (let i = 0; i < subs.length; i += BATCH) {
    await Promise.all(subs.slice(i, i + BATCH).map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          body,
          { TTL: opts.ttl || 4 * 3600, urgency: opts.urgency || 'normal', timeout: 10000 }
        );
        summary.devicesSent++;
        reached.add(s.volunteer_id);
        ok.push(s.id);
      } catch (err) {
        summary.devicesFailed++;
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          gone.push(s.id);
        } else {
          console.error('Push failed (' + (err && err.statusCode) + '):', err && (err.body || err.message));
        }
      }
    }));
  }

  if (ok.length) await db.sql`UPDATE push_subscriptions SET last_success_at = NOW() WHERE id = ANY(${ok})`;
  if (gone.length) {
    await db.sql`DELETE FROM push_subscriptions WHERE id = ANY(${gone})`;
    summary.devicesRemoved += gone.length;
  }
  summary.volunteersReached += reached.size;
  return summary;
}

// The daily shift reminder push: each volunteer gets their own content.
// reminders: from loadShiftReminders(). Never throws (reminder emails
// matter more), returns the same summary shape plus volunteersPushed.
export async function sendReminderPushes(db, reminders, tonight) {
  const total = { volunteersReached: 0, devicesSent: 0, devicesFailed: 0, devicesRemoved: 0 };
  if (!pushConfigured() || !reminders.length) return total;
  try {
    const ids = reminders.map((r) => r.volunteerId);
    const subs = await db.sql`
      SELECT id, volunteer_id, endpoint, p256dh, auth FROM push_subscriptions
      WHERE volunteer_id = ANY(${ids})
    `;
    for (const r of reminders) {
      const mine = subs.filter((s) => s.volunteer_id === r.volunteerId);
      if (!mine.length) continue;
      await sendToSubscriptions(db, mine, reminderPushContent(r.shifts, tonight), { ttl: 10 * 3600, urgency: 'normal' }, total);
    }
  } catch (err) {
    console.error('Reminder pushes failed:', err);
    total.error = err.message;
  }
  return total;
}
