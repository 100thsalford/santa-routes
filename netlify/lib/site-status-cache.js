// How long the CDN may keep a get-site-status answer: until the next
// moment it could change on its own (London midnight, today's sightings or
// tracking window start/end, an admin override expiring), between
// MIN_CACHE_SECONDS and MAX_CACHE_SECONDS. See get-site-status.js.

import { londonTimeString, londonMidnightAfter } from './tracking-window.js';

export const MAX_CACHE_SECONDS = 900;
export const MIN_CACHE_SECONDS = 15;

function minutesOf(hhmm) {
  const m = /^(\d{2}):(\d{2})$/.exec(String(hhmm || '').trim());
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

// Seconds from `now` until the next of today's HH:MM boundaries (London
// time), the next London midnight, or any extra absolute times given.
export function secondsUntilNextChange(now, hhmmTimes, extraTimesMs) {
  const nowMs = now.getTime();
  const nowMin = minutesOf(londonTimeString(now));
  const secsIntoMinute = now.getUTCSeconds();
  const candidates = [(londonMidnightAfter(now).getTime() - nowMs) / 1000];
  for (const t of hhmmTimes) {
    const m = minutesOf(t);
    if (m !== null && nowMin !== null && m > nowMin) candidates.push((m - nowMin) * 60 - secsIntoMinute);
  }
  for (const ms of extraTimesMs || []) {
    if (Number.isFinite(ms) && ms > nowMs) candidates.push((ms - nowMs) / 1000);
  }
  return Math.min(...candidates.filter((c) => c > 0));
}

export function cacheSecondsFor(now, hhmmTimes, extraTimesMs) {
  const secs = Math.floor(secondsUntilNextChange(now, hhmmTimes, extraTimesMs));
  return Math.max(MIN_CACHE_SECONDS, Math.min(MAX_CACHE_SECONDS, secs));
}
