// Checks the live-tracking state logic (schedule + admin Auto/On/Off
// override) in netlify/lib/tracking-window.js. Plain Node, no deps:
//   node tests/tracking-window.test.mjs
import assert from 'node:assert/strict';
import { trackingWindow, activeOverride, londonMidnightAfter } from '../netlify/lib/tracking-window.js';

const at = (iso) => new Date(iso);
const route = { tracking_end_time: '21:30' };
const base = { tracking_window_start: '17:00', tracking_window_end: '22:00' };
const ov = (mode, extra = {}) => ({ ...base, tracking_override_mode: mode, ...extra });

// Schedule (Auto)
assert.equal(trackingWindow(base, null, at('2026-12-01T18:00:00Z')).state, 'not-a-route-day');
assert.equal(trackingWindow(base, route, at('2026-12-01T16:00:00Z')).state, 'before-window');
assert.equal(trackingWindow(base, route, at('2026-12-01T18:00:00Z')).state, 'active');
assert.equal(trackingWindow(base, route, at('2026-12-01T21:45:00Z')).state, 'after-window');

// Forced On (public) on a non-route day, before expiry
const onPublic = ov('on', { tracking_override_visibility: 'public', tracking_override_from: '2026-11-20T10:00:00Z', tracking_override_until: '2026-11-20T12:00:00Z' });
let w = trackingWindow(onPublic, null, at('2026-11-20T11:00:00Z'));
assert.equal(w.state, 'active'); assert.equal(w.forced, true); assert.equal(w.end, '12:00');
// ...expired -> schedule again
assert.equal(trackingWindow(onPublic, null, at('2026-11-20T12:00:00Z')).state, 'not-a-route-day');

// Forced On (admin only): public unaffected, admin preview active
const onAdmin = { ...onPublic, tracking_override_visibility: 'admin' };
assert.equal(trackingWindow(onAdmin, null, at('2026-11-20T11:00:00Z')).state, 'not-a-route-day');
assert.equal(trackingWindow(onAdmin, null, at('2026-11-20T11:00:00Z'), { viewerIsAdmin: true }).state, 'active');

// On without a valid expiry fails closed
assert.equal(activeOverride(ov('on', { tracking_override_visibility: 'public' }), Date.now()), null);

// Forced Off: during a live window, and indefinitely
const offTonight = ov('off', { tracking_override_until: '2026-12-02T00:00:00Z' });
assert.equal(trackingWindow(offTonight, route, at('2026-12-01T18:00:00Z')).state, 'stopped');
assert.equal(trackingWindow(offTonight, route, at('2026-12-02T18:00:00Z')).state, 'active'); // next night back to normal
const offAlways = ov('off', { tracking_override_until: '' });
assert.equal(trackingWindow(offAlways, route, at('2027-12-01T18:00:00Z')).state, 'stopped');
assert.equal(trackingWindow(offAlways, null, at('2027-12-01T18:00:00Z')).state, 'not-a-route-day');

// London midnight across GMT and BST
assert.equal(londonMidnightAfter(at('2026-12-01T20:00:00Z')).toISOString(), '2026-12-02T00:00:00.000Z');
assert.equal(londonMidnightAfter(at('2026-07-01T20:00:00Z')).toISOString(), '2026-07-01T23:00:00.000Z');
assert.equal(londonMidnightAfter(at('2026-07-01T23:30:00Z')).toISOString(), '2026-07-02T23:00:00.000Z');

console.log('tracking-window: all checks passed');
