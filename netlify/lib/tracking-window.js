// Live-tracking state for "now" -- the one place that decides whether the
// sleigh's position is shown. Used by get-tracking-data.js (which enforces
// it before touching TruTrak), get-site-status.js (Track Santa Live button
// + admin Dashboard pill) and admin-settings.js (override writes).
//
// Schedule ("Auto"):
//   start: settings.tracking_window_start (falls back to the sightings start)
//   end:   tonight's route_dates.tracking_end_time if set, else
//          settings.tracking_window_end (falls back to the sightings end)
//   Only on a route night.
//
// Admin override (Dashboard "Auto / On / Off"), stored in settings:
//   tracking_override_mode        '' (auto) | 'on' | 'off'
//   tracking_override_visibility  'public' | 'admin'   (on only)
//   tracking_override_from        ISO time it was switched on/off
//   tracking_override_until       ISO expiry; '' = until switched back
//                                 (off only -- on always expires)
// Once `until` passes the override is ignored and the schedule applies
// again, so a forgotten "On" can never leave the sleigh's parked location
// public. "On" with visibility 'admin' only applies to signed-in admins
// viewing track.html?preview=1 -- the public keeps the schedule.

export const TIME_ZONE = 'Europe/London';
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function londonDateString(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

export function londonTimeString(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(date);
}

// TruTrak-style local timestamp ("2026-12-01T18:30:00", no offset).
export function londonLocalStamp(date) {
  return `${londonDateString(date)}T${londonTimeString(date)}:00`;
}

// The next London midnight after `date`, as a Date (handles GMT/BST).
export function londonMidnightAfter(date) {
  const today = londonDateString(date);
  const d = new Date(today + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  const guess = d.getTime();
  const hh = parseInt(londonTimeString(new Date(guess)).slice(0, 2), 10); // 0 in GMT, 1 in BST
  return new Date(guess - hh * 3600000);
}

// The override currently in force, or null (auto / expired / malformed).
export function activeOverride(settings, nowMs) {
  const mode = String(settings.tracking_override_mode || '').trim();
  if (mode !== 'on' && mode !== 'off') return null;
  const until = settings.tracking_override_until ? Date.parse(settings.tracking_override_until) : NaN;
  if (Number.isFinite(until) && nowMs >= until) return null;
  // "On" must always have a valid expiry -- fail closed if it doesn't.
  if (mode === 'on' && !Number.isFinite(until)) return null;
  const from = settings.tracking_override_from ? Date.parse(settings.tracking_override_from) : NaN;
  return {
    mode,
    visibility: mode === 'on' && settings.tracking_override_visibility === 'admin' ? 'admin' : 'public',
    from: Number.isFinite(from) ? new Date(from).toISOString() : null,
    until: Number.isFinite(until) ? new Date(until).toISOString() : null
  };
}

// state: 'active' | 'before-window' | 'after-window' | 'stopped' | 'not-a-route-day'
// forced: true when an admin "On" override is what made it active.
// `viewerIsAdmin` lets an admin-only "On" apply (admin preview).
export function trackingWindow(settings, todayRoute, now, { viewerIsAdmin = false } = {}) {
  const nowMs = now.getTime();
  const nowTime = londonTimeString(now);
  const pick = (...vals) => vals.find((v) => v && TIME_RE.test(String(v).trim()));
  const start = pick(settings.tracking_window_start, settings.sightings_window_start) || '17:00';
  const end = pick(todayRoute && todayRoute.tracking_end_time, settings.tracking_window_end, settings.sightings_window_end) || '22:00';
  const override = activeOverride(settings, nowMs);

  if (override && override.mode === 'off') {
    return { start, end, state: todayRoute ? 'stopped' : 'not-a-route-day', active: false, forced: false, override };
  }
  if (override && override.mode === 'on' && (override.visibility === 'public' || viewerIsAdmin)) {
    return {
      start: override.from ? londonTimeString(new Date(override.from)) : start,
      end: londonTimeString(new Date(override.until)),
      state: 'active',
      active: true,
      forced: true,
      override
    };
  }

  let state;
  if (!todayRoute) state = 'not-a-route-day';
  else if (nowTime < start) state = 'before-window';
  else if (nowTime >= end) state = 'after-window';
  else state = 'active';
  return { start, end, state, active: state === 'active', forced: false, override };
}
