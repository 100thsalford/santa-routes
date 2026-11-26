// Checks the analytics Blobs buffer (netlify/lib/analytics-buffer.js) and
// get-site-status's "cache until the next time boundary" logic, with an
// in-memory blob store and a fake database. Plain Node, no network:
//   node tests/analytics-buffer.test.mjs
import assert from 'node:assert/strict';
import { bufferRecord, flushAnalyticsBuffer, bufferContext } from '../netlify/lib/analytics-buffer.js';
import { secondsUntilNextChange, cacheSecondsFor } from '../netlify/lib/site-status-cache.js';

function memoryStore() {
  const m = new Map();
  return {
    m,
    async setJSON(k, v) { m.set(k, JSON.stringify(v)); },
    async get(k) { return m.has(k) ? JSON.parse(m.get(k)) : null; },
    async delete(k) { m.delete(k); },
    async list({ prefix }) { return { blobs: [...m.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })) }; }
  };
}

// Fake tagged-template db: records each query's text and values.
function fakeDb({ signs = ['001', '002'] } = {}) {
  const calls = [];
  const sql = async (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    if (/SELECT sign_id FROM qr_signs/.test(text)) return signs.map((sign_id) => ({ sign_id }));
    return [];
  };
  return { sql, calls };
}

let checks = 0;
const ok = (label) => { checks++; console.log('ok - ' + label); };

// --- deploy context
assert.equal(bufferContext({ deploy: { context: 'production' } }), 'production');
assert.equal(bufferContext({ deploy: { context: 'branch-deploy' } }), 'non-production');
ok('deploy context separates production from everything else');

// --- buffer + flush
{
  const store = memoryStore();
  await bufferRecord('production', 'event', { eventType: 'page_view', eventData: { title: 'Home' }, page: '/' }, { blobStore: store });
  await bufferRecord('production', 'event', { eventType: 'qr_sign_visit', eventData: { sign_id: '001' }, page: '/s/001' }, { blobStore: store });
  await bufferRecord('production', 'event', { eventType: 'qr_sign_visit', eventData: { sign_id: '999' }, page: '/s/999' }, { blobStore: store });
  await bufferRecord('production', 'search', { searchTerm: 'acacia ave', matchFound: true, matchedStreet: 'Acacia Avenue', resultsCount: 1, page: '/' }, { blobStore: store });
  await bufferRecord('non-production', 'event', { eventType: 'page_view', eventData: {}, page: '/' }, { blobStore: store });
  assert.equal(store.m.size, 5);
  ok('each event becomes its own blob');

  const db = fakeDb();
  const res = await flushAnalyticsBuffer(db, 'production', { blobStore: store });
  assert.deepEqual(res, { events: 2, searches: 1, remaining: false });
  ok('flush copies production events and searches, dropping the unknown QR sign');

  const evInsert = db.calls.find((c) => /INSERT INTO analytics_events/.test(c.text));
  assert.ok(/ON CONFLICT \(buffer_key\) DO NOTHING/.test(evInsert.text));
  const [times, types, datas, pages, keys] = evInsert.values;
  assert.deepEqual(types.sort(), ['page_view', 'qr_sign_visit']);
  assert.ok(datas.every((d) => typeof d === 'string' && JSON.parse(d)));
  assert.ok(times.every((t) => !isNaN(Date.parse(t))));
  assert.ok(keys.every((k) => k.startsWith('production/event/')));
  assert.equal(pages.length, 2);
  ok('event insert carries original timestamps, JSON data and unique buffer keys');

  const srInsert = db.calls.find((c) => /INSERT INTO search_logs/.test(c.text));
  assert.equal(srInsert.values[1][0], 'acacia ave');
  assert.equal(srInsert.values[2][0], true);
  ok('search insert carries the minimised term and match flag');

  assert.deepEqual([...store.m.keys()].map((k) => k.split('/')[0]), ['non-production']);
  ok('flushed blobs are deleted; other deploy context left alone');

  const again = await flushAnalyticsBuffer(fakeDb(), 'production', { blobStore: store });
  assert.deepEqual(again, { events: 0, searches: 0, remaining: false });
  ok('second flush finds nothing');
}

// --- failed insert leaves blobs for next time
{
  const store = memoryStore();
  await bufferRecord('production', 'event', { eventType: 'page_view', eventData: {}, page: '/' }, { blobStore: store });
  const db = { sql: async () => { throw new Error('db down'); } };
  await assert.rejects(flushAnalyticsBuffer(db, 'production', { blobStore: store }));
  assert.equal(store.m.size, 1);
  ok('database failure keeps buffered events');
}

// --- site status cache length (London = UTC in December)
const at = (iso) => new Date(iso);
const times = ['17:00', '22:00', '17:00', '21:30'];
assert.equal(secondsUntilNextChange(at('2026-12-01T16:58:00Z'), times), 120);
assert.equal(cacheSecondsFor(at('2026-12-01T16:58:00Z'), times), 120);
ok('cache expires when the sightings/tracking window opens');
assert.equal(cacheSecondsFor(at('2026-12-01T21:29:30Z'), times), 30);
ok('cache expires at tonight\'s tracking end time');
assert.equal(cacheSecondsFor(at('2026-12-01T21:59:58Z'), times), 15);
ok('never shorter than the 15s floor');
assert.equal(cacheSecondsFor(at('2026-12-01T10:00:00Z'), times), 900);
ok('capped at 15 minutes when nothing is due');
assert.equal(cacheSecondsFor(at('2026-12-01T23:55:00Z'), times), 300);
ok('expires at London midnight');
assert.equal(cacheSecondsFor(at('2026-12-01T10:00:00Z'), times, [Date.parse('2026-12-01T10:05:00Z')]), 300);
ok('expires when an admin override ends');
assert.equal(cacheSecondsFor(at('2026-07-01T20:55:00Z'), ['22:00']), 300);
ok('British Summer Time: 22:00 London is 21:00 UTC');

console.log('\n' + checks + ' checks passed');
