// Checks for the shift reminder email (netlify/lib/shift-reminder-email.js),
// run with plain Node (no dependencies, no build step):
//   node tests/shift-reminder-email.test.mjs
import assert from 'node:assert/strict';
import { shiftReminderEmail } from '../netlify/lib/shift-reminder-email.js';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok - ' + name);
}

const streets = [{ name: 'Acacia Avenue', timeRange: '18:00–18:20' }, { name: 'Elm Road', timeRange: '18:20–18:40' }];
const opts = { portalUrl: 'https://example.org/volunteer.html?login=1', tonight: true };
function shift(extra) {
  return Object.assign({ routeName: 'Route 3', eventDate: '2026-12-14', role: null, eventRoles: [], streets }, extra);
}

test('plain volunteer: no banner, unchanged subject', () => {
  const { subject, html } = shiftReminderEmail([shift()], opts);
  assert.equal(subject, 'Tonight’s shift: Route 3 🎅');
  assert.ok(!html.includes('You\'re Santa'));
  assert.ok(!html.includes('find cover'));
});

test('Santa: banner at the top, role in subject, pill on card', () => {
  const { subject, html } = shiftReminderEmail([shift({ eventRoles: ['santa'] })], opts);
  assert.equal(subject, 'Tonight you\'re Santa: Route 3 🎅');
  assert.ok(html.includes('🎅&nbsp; You\'re Santa tonight'));
  assert.ok(html.indexOf('find cover') < html.indexOf('Acacia Avenue'), 'banner sits above the route card');
  assert.ok(html.includes('🎅 Santa</span>'));
  assert.ok(!html.includes('counting on you'));
});

test('Driver and Safety Walker get "the"', () => {
  assert.ok(shiftReminderEmail([shift({ eventRoles: ['driver'] })], opts).html.includes('You\'re the Driver tonight'));
  const { subject, html } = shiftReminderEmail([shift({ eventRoles: ['safety_walker'] })], opts);
  assert.ok(html.includes('You\'re the Safety Walker tonight'));
  assert.equal(subject, 'Tonight you\'re the Safety Walker: Route 3 🎅');
});

test('two roles on one night are both listed', () => {
  const { subject, html } = shiftReminderEmail([shift({ eventRoles: ['driver', 'safety_walker'] })], opts);
  assert.equal(subject, 'Tonight you\'re the Driver and the Safety Walker: Route 3 🎅');
  assert.ok(html.includes('You\'re the Driver tonight') && html.includes('You\'re the Safety Walker tonight'));
});

test('role on one of two routes only flags that route', () => {
  const { subject, html } = shiftReminderEmail(
    [shift({ routeName: 'Route 1' }), shift({ routeName: 'Route 2', eventRoles: ['santa'] })], opts);
  assert.equal(subject, 'Tonight you\'re Santa: 2 routes 🎅');
  assert.ok(html.includes('on Route 2</div>'));
  assert.ok(!html.includes('on Route 1</div>'));
});

test('admin send for another date names the date instead of "tonight"', () => {
  const { subject, html } = shiftReminderEmail([shift({ eventRoles: ['santa'] })], Object.assign({}, opts, { tonight: false }));
  assert.equal(subject, 'Shift reminder (you\'re Santa): Route 3 🎅');
  assert.ok(html.includes('You\'re Santa on Monday 14 December'));
});

test('free-text shift role still shows when there is no special role', () => {
  const { html } = shiftReminderEmail([shift({ role: 'Collector' })], opts);
  assert.ok(html.includes('Collector</span>'));
});

console.log(passed + ' passed');
