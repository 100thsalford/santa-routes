// Checks for the push notification helpers (netlify/lib/push.js).
// Run with:
//   node tests/push.test.mjs
// (needs `npm install` first, for the web-push package)

import assert from 'node:assert/strict';
import {
  isAllowedEndpoint, cleanSubscription, clampText, safePath, buildPayload,
  reminderPushContent, TITLE_MAX, BODY_MAX
} from '../netlify/lib/push.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

check('real push services are allowed', () => {
  assert.ok(isAllowedEndpoint('https://web.push.apple.com/QGk1abc'));
  assert.ok(isAllowedEndpoint('https://fcm.googleapis.com/fcm/send/abc:def'));
  assert.ok(isAllowedEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc'));
  assert.ok(isAllowedEndpoint('https://wns2-db5p.notify.windows.com/w/?token=abc'));
});

check('anything else is refused', () => {
  assert.equal(isAllowedEndpoint('http://fcm.googleapis.com/fcm/send/abc'), false);
  assert.equal(isAllowedEndpoint('https://example.com/push'), false);
  assert.equal(isAllowedEndpoint('https://push.apple.com.evil.example/x'), false);
  assert.equal(isAllowedEndpoint('https://evilpush.apple.com/x'), false);
  assert.equal(isAllowedEndpoint('https://localhost/x'), false);
  assert.equal(isAllowedEndpoint('not a url'), false);
  assert.equal(isAllowedEndpoint(null), false);
});

check('cleanSubscription accepts a browser subscription', () => {
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' } };
  assert.deepEqual(cleanSubscription(sub), { endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth });
});

check('cleanSubscription rejects bad keys or endpoints', () => {
  assert.equal(cleanSubscription({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'abc<script>', auth: 'x' } }), null);
  assert.equal(cleanSubscription({ endpoint: 'https://example.com/x', keys: { p256dh: 'abc', auth: 'x' } }), null);
  assert.equal(cleanSubscription({ endpoint: 'https://fcm.googleapis.com/x' }), null);
  assert.equal(cleanSubscription(null), null);
});

check('clampText trims, squashes whitespace and adds an ellipsis', () => {
  assert.equal(clampText('  hello\n\n world  ', 50), 'hello world');
  const long = clampText('x'.repeat(200), 60);
  assert.equal(long.length, 60);
  assert.ok(long.endsWith('…'));
});

check('safePath only allows paths on this site', () => {
  assert.equal(safePath('/volunteer.html?show=schedule'), '/volunteer.html?show=schedule');
  assert.equal(safePath('https://evil.example/'), '/volunteer.html');
  assert.equal(safePath('//evil.example/'), '/volunteer.html');
  assert.equal(safePath(undefined), '/volunteer.html');
});

check('buildPayload clamps title and body', () => {
  const p = buildPayload({ title: 'T'.repeat(100), body: 'B'.repeat(400), url: '/x', tag: 'a' });
  assert.equal(p.title.length, TITLE_MAX);
  assert.equal(p.body.length, BODY_MAX);
  assert.equal(p.url, '/x');
  assert.equal(buildPayload({ title: '', body: 'x' }).title, 'Santa Super Sleigh Salford');
});

const shift = (o) => Object.assign({
  routeName: 'Route A — R1', eventDate: '2026-11-30', gatheringTime: '5:45pm',
  what3words: 'apple.banana.cherry', eventRoles: [], streets: []
}, o);

check('reminder push for one shift tonight', () => {
  const p = reminderPushContent([shift()], true);
  assert.equal(p.title, "🎅 You're on tonight: Route A — R1");
  assert.equal(p.body, 'Gather 5:45pm at ///apple.banana.cherry. Tap for your streets and map.');
  assert.equal(p.url, '/volunteer.html?login=1&show=schedule');
  assert.equal(p.tag, 'shift-reminder-2026-11-30');
});

check('reminder push mentions a special role', () => {
  const p = reminderPushContent([shift({ eventRoles: ['santa'] })], true);
  assert.ok(p.body.startsWith("You're Santa tonight!"));
});

check('reminder push for two routes, no meeting details', () => {
  const p = reminderPushContent([shift({ gatheringTime: null, what3words: null }), shift({ routeName: 'Route B' })], true);
  assert.equal(p.title, "🎅 You're on 2 routes tonight");
  assert.equal(p.body, 'Tap for your streets and map.');
});

check('reminder push sent for another date names the date', () => {
  const p = reminderPushContent([shift()], false);
  assert.equal(p.title, '🎅 Reminder Mon 30 Nov: Route A — R1');
});

console.log('\n' + passed + ' checks passed');
