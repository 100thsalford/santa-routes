// Automated checks for the QR sign hop (qr.html + privacy-prefs.js), run
// with plain Node (no dependencies, no build step):
//   node tests/qr-redirect.test.mjs
// It runs the real scripts against a minimal fake browser and checks that
// every case lands on the homepage, and that a qr_sign_visit event is sent
// only when analytics are allowed.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const root = new URL('..', import.meta.url);
const prefsJs = readFileSync(new URL('privacy-prefs.js', root), 'utf8');
const qrHtml = readFileSync(new URL('qr.html', root), 'utf8');
const qrJs = [...qrHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

function run(path, opts = {}) {
  const sent = [];
  const fetched = [];
  const replaced = [];
  const listeners = {};
  const storage = new Map(Object.entries(opts.storage || {}));
  const appended = [];
  const el = () => ({ setAttribute() {}, appendChild() {}, set textContent(v) {}, hidden: true });
  const document = {
    cookie: '',
    prerendering: !!opts.prerendering,
    head: { appendChild: (n) => appended.push(n) },
    documentElement: { appendChild: (n) => appended.push(n) },
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: el,
    getElementById: () => null,
    addEventListener: (t, fn) => { listeners[t] = fn; }
  };
  const navigator = {
    globalPrivacyControl: !!opts.gpc,
    webdriver: !!opts.webdriver,
    sendBeacon: opts.noBeacon ? undefined : (url, body) => {
      if (opts.beaconThrows) throw new Error('blocked by extension');
      sent.push({ url, body: JSON.parse(body) });
      return opts.beaconReturns !== undefined ? opts.beaconReturns : true;
    }
  };
  // In a browser, window is the global object: mirror that here.
  const ctx = vm.createContext({
    document,
    navigator,
    location: {
      pathname: path,
      hostname: opts.hostname || 'santasleighsalford.co.uk',
      replace: (u) => replaced.push(u),
      set href(u) { replaced.push(u); }
    },
    localStorage: opts.noStorage
      ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } }
      : { getItem: (k) => (storage.has(k) ? storage.get(k) : null), setItem: (k, v) => storage.set(k, v) },
    setTimeout: () => 0,
    fetch: (url, init) => { fetched.push({ url, init, body: JSON.parse(init.body) }); return Promise.resolve({}); }
  });
  vm.runInContext('var window = this;', ctx);
  // Same order as the page: flag script, privacy-prefs.js, then the hop.
  vm.runInContext(qrJs[0], ctx);
  if (!opts.noPrefs) vm.runInContext(prefsJs, ctx);
  vm.runInContext(qrJs[1], ctx);
  return { sent, fetched, replaced, listeners, appended };
}

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('ok -', name);
}

for (let i = 1; i <= 45; i++) {
  const id = String(i).padStart(3, '0');
  const r = run('/s/' + id);
  assert.deepEqual(r.replaced, ['/'], id + ' should go home');
  assert.equal(r.sent.length, 1, id + ' should send one event');
  assert.deepEqual(r.sent[0].body, { eventType: 'qr_sign_visit', eventData: { sign_id: id }, page: '/s/' + id });
}
passed++; console.log('ok - all 45 sign URLs go home and send exactly one event');

test('trailing slash accepted', () => {
  const r = run('/s/023/');
  assert.equal(r.sent[0].body.eventData.sign_id, '023');
  assert.deepEqual(r.replaced, ['/']);
});

for (const bad of ['/s/000', '/s/1', '/s/23', '/s/0023', '/s/abc', '/s/', '/s/023x', '/qr.html', "/s/0';"]) {
  test('invalid ' + bad + ' goes home with no event', () => {
    const r = run(bad);
    assert.deepEqual(r.replaced, ['/']);
    assert.equal(r.sent.length + r.fetched.length, 0);
  });
}

test('analytics switched off: no event, still home', () => {
  const r = run('/s/001', { storage: { sss_analytics_pref: 'off' } });
  assert.equal(r.sent.length + r.fetched.length, 0);
  assert.deepEqual(r.replaced, ['/']);
});

test('Global Privacy Control: no event, still home', () => {
  const r = run('/s/001', { gpc: true });
  assert.equal(r.sent.length + r.fetched.length, 0);
  assert.deepEqual(r.replaced, ['/']);
});

test('GPC but visitor explicitly chose on: event sent', () => {
  const r = run('/s/001', { gpc: true, storage: { sss_analytics_pref: 'on' } });
  assert.equal(r.sent.length, 1);
});

test('privacy-prefs.js failed to load: fail closed, still home', () => {
  const r = run('/s/001', { noPrefs: true });
  assert.equal(r.sent.length + r.fetched.length, 0);
  assert.deepEqual(r.replaced, ['/']);
});

test('local storage blocked: default on (as rest of site), still home', () => {
  const r = run('/s/007', { noStorage: true });
  assert.equal(r.sent.length, 1);
  assert.deepEqual(r.replaced, ['/']);
});

test('sendBeacon refused: falls back to fetch keepalive', () => {
  const r = run('/s/045', { beaconReturns: false });
  assert.equal(r.fetched.length, 1);
  assert.equal(r.fetched[0].init.keepalive, true);
  assert.deepEqual(r.replaced, ['/']);
});

test('sendBeacon throws (ad blocker): still home', () => {
  const r = run('/s/045', { beaconThrows: true });
  assert.deepEqual(r.replaced, ['/']);
});

test('no sendBeacon support: fetch keepalive', () => {
  const r = run('/s/012', { noBeacon: true });
  assert.equal(r.fetched.length, 1);
});

test('automated browser (webdriver): no event, still home', () => {
  const r = run('/s/001', { webdriver: true });
  assert.equal(r.sent.length, 0);
  assert.deepEqual(r.replaced, ['/']);
});

test('prerender: nothing until the visitor actually opens it', () => {
  const r = run('/s/030', { prerendering: true });
  assert.equal(r.sent.length, 0);
  assert.equal(r.replaced.length, 0);
  r.listeners.prerenderingchange();
  assert.equal(r.sent.length, 1);
  assert.deepEqual(r.replaced, ['/']);
});

test('admin test device: event flagged test', () => {
  const r = run('/s/001', { storage: { sss_admin_device: '1' } });
  assert.deepEqual(r.sent[0].body.eventData, { sign_id: '001', test: true });
});

test('Cloudflare beacon not injected on the hop', () => {
  const r = run('/s/001');
  assert.equal(r.appended.length, 0);
});

console.log('\n' + passed + ' checks passed');
