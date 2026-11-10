// Checks for the shift reminder email (netlify/lib/shift-reminder-email.js),
// run with plain Node (no dependencies, no build step):
//   node tests/shift-reminder-email.test.mjs
import assert from 'node:assert/strict';
import { shiftReminderEmail } from '../netlify/lib/shift-reminder-email.js';
import { reminderTodo } from '../netlify/lib/shift-reminders.js';

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

// ---- "Before you head out" box ----

test('nothing to do: no box', () => {
  const { html } = shiftReminderEmail([shift()], Object.assign({}, opts, { todo: { briefing: false, square: null } }));
  assert.ok(!html.includes('Before you head out'));
});

test('briefing not watched: link to the portal', () => {
  const { html } = shiftReminderEmail([shift()], Object.assign({}, opts, { todo: { briefing: true, square: null } }));
  assert.ok(html.includes('Before you head out'));
  assert.ok(html.includes('Watch the briefing'));
  assert.ok(!html.includes('show=card-payments'));
});

test('Square not signed up: deep link opens card payments', () => {
  const { html } = shiftReminderEmail([shift()], Object.assign({}, opts, { todo: { briefing: false, square: 'none' } }));
  assert.ok(html.includes('Sign up for card payments'));
  assert.ok(html.includes('volunteer.html?login=1&amp;show=card-payments'));
  assert.ok(!html.includes('Watch the briefing'));
});

test('Square requested: reminder to accept the invitation', () => {
  const { html } = shiftReminderEmail([shift()], Object.assign({}, opts, { todo: { briefing: true, square: 'requested' } }));
  assert.ok(html.includes('Accept your Square invitation'));
  assert.ok(html.includes('Watch the briefing'));
  assert.ok(html.indexOf('Acacia Avenue') < html.indexOf('Before you head out'), 'box sits after the route card');
});

const baseRow = { is_guest: false, briefing_ack_at: null, square_requested_at: null, square_approved_at: null };
const plain = [shift()];

test('todo: new volunteer gets both nudges', () => {
  assert.deepEqual(reminderTodo(baseRow, plain, true), { briefing: true, square: 'none' });
});

test('todo: briefing watched and Square approved gets nothing', () => {
  const row = Object.assign({}, baseRow, { briefing_ack_at: new Date(), square_requested_at: new Date(), square_approved_at: new Date() });
  assert.deepEqual(reminderTodo(row, plain, true), { briefing: false, square: null });
});

test('todo: Square requested but not approved', () => {
  const row = Object.assign({}, baseRow, { square_requested_at: new Date() });
  assert.equal(reminderTodo(row, plain, true).square, 'requested');
});

test('todo: guests get nothing', () => {
  assert.deepEqual(reminderTodo(Object.assign({}, baseRow, { is_guest: true }), plain, true), { briefing: false, square: null });
});

test('todo: no Square nudge when Square is switched off', () => {
  assert.equal(reminderTodo(baseRow, plain, false).square, null);
});

test('todo: Santa and Driver skip Square, Safety Walker does not', () => {
  assert.equal(reminderTodo(baseRow, [shift({ eventRoles: ['santa'] })], true).square, null);
  assert.equal(reminderTodo(baseRow, [shift({ eventRoles: ['driver'] })], true).square, null);
  assert.equal(reminderTodo(baseRow, [shift({ eventRoles: ['safety_walker'] })], true).square, 'none');
  assert.equal(reminderTodo(baseRow, [shift({ eventRoles: ['santa'] })], true).briefing, true);
});

test('todo: Santa on one route but general volunteer on another still gets Square', () => {
  assert.equal(reminderTodo(baseRow, [shift({ eventRoles: ['santa'] }), shift({ routeName: 'Route 4' })], true).square, 'none');
});

// ---- Meeting details ----

test('gathering time, meeting point and notes show on the route card', () => {
  const { html } = shiftReminderEmail([shift({
    gatheringTime: '5:45pm', what3words: 'filled.count.soap', notes: 'Park on Elm Road.\nBring a torch & hi-vis.'
  })], opts);
  assert.ok(html.includes('⏰ Gather at 5:45pm'));
  assert.ok(html.includes('href="https://w3w.co/filled.count.soap"'));
  assert.ok(html.includes('///filled.count.soap'));
  assert.ok(html.includes('Park on Elm Road.<br>Bring a torch &amp; hi-vis.'));
  assert.ok(html.indexOf('Gather at') < html.indexOf('Acacia Avenue'), 'details sit above the street list');
  assert.ok(!html.includes('Meeting point, gathering time'));
});

test('missing meeting details are left out', () => {
  const { html } = shiftReminderEmail([shift({ what3words: 'filled.count.soap' })], opts);
  assert.ok(!html.includes('Gather at'));
  assert.ok(!html.includes('📝'));
  assert.ok(html.includes('///filled.count.soap'));
});

test('notes are escaped', () => {
  const { html } = shiftReminderEmail([shift({ notes: '<script>x</script>' })], opts);
  assert.ok(!html.includes('<script>'));
});

console.log(passed + ' passed');
