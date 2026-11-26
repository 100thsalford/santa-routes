// Buffers site analytics events and street searches in Netlify Blobs, so
// logging them doesn't wake the database.
//
// Why: Netlify Database bills for every hour it is awake and only goes to
// sleep after 5 minutes with no queries. log-analytics.js and log-search.js
// used to INSERT on every page view, tab switch and search, so the database
// never got those 5 quiet minutes while anyone was on the site. Now each
// event is written to Blobs the moment it happens (same reliability as
// before -- nothing is held back in the visitor's browser) and copied into
// analytics_events / search_logs later, in one go:
//   - nightly, by purge-old-logs.js (which wakes the database anyway), and
//   - whenever the admin opens a report that reads those tables
//     (admin-site-activity, admin-search-activity, admin-qr-signs), so the
//     admin view is always up to date.
//
// One blob per event (concurrent function calls can't safely append to a
// shared blob). Keys are "<deploy context>/<kind>/<ISO time>-<random>",
// so staging's events never end up in production's tables and a flush
// copies oldest first. Each row is inserted with its blob key in
// buffer_key (unique), so if two flushes overlap, or a blob delete fails
// after its insert, the same event is never stored twice.
//
// Privacy: blobs hold exactly what the tables would (already minimised by
// the logging functions) and normally live for less than a day.

import { getStore } from '@netlify/blobs';

const STORE_NAME = 'analytics-buffer';
const KINDS = ['event', 'search'];
const PARALLEL = 40;
const INSERT_CHUNK = 250;

function store() {
  return getStore(STORE_NAME);
}

// 'production' for the live site; anything else (branch-deploy,
// deploy-preview, dev) is kept separate.
export function bufferContext(context) {
  const c = (context && context.deploy && context.deploy.context) || process.env.CONTEXT || 'dev';
  return c === 'production' ? 'production' : 'non-production';
}

function newKey(ctx, kind) {
  const rand = Math.random().toString(36).slice(2, 10);
  return ctx + '/' + kind + '/' + new Date().toISOString() + '-' + rand;
}

// kind: 'event' (analytics_events row) or 'search' (search_logs row).
// `blobStore` is only passed by tests.
export async function bufferRecord(ctx, kind, record, { blobStore } = {}) {
  if (KINDS.indexOf(kind) === -1) throw new Error('Unknown buffer kind: ' + kind);
  const body = Object.assign({}, record, { createdAt: new Date().toISOString() });
  await (blobStore || store()).setJSON(newKey(ctx, kind), body);
}

async function inParallel(items, fn) {
  const out = new Array(items.length);
  for (let i = 0; i < items.length; i += PARALLEL) {
    const slice = items.slice(i, i + PARALLEL);
    const results = await Promise.all(slice.map(fn));
    for (let j = 0; j < results.length; j++) out[i + j] = results[j];
  }
  return out;
}

async function insertEvents(db, rows, validSigns) {
  const keep = rows.filter((r) => r.eventType !== 'qr_sign_visit' ||
    (r.eventData && validSigns.has(r.eventData.sign_id)));
  if (!keep.length) return 0;
  await db.sql`
    INSERT INTO analytics_events (created_at, event_type, event_data, page, buffer_key)
    SELECT t.created_at, t.event_type, t.event_data::jsonb, t.page, t.buffer_key
    FROM unnest(
      ${keep.map((r) => r.createdAt)}::timestamptz[],
      ${keep.map((r) => String(r.eventType || 'unknown'))}::text[],
      ${keep.map((r) => JSON.stringify(r.eventData || {}))}::text[],
      ${keep.map((r) => r.page || null)}::text[],
      ${keep.map((r) => r.key)}::text[]
    ) AS t(created_at, event_type, event_data, page, buffer_key)
    ON CONFLICT (buffer_key) DO NOTHING
  `;
  return keep.length;
}

async function insertSearches(db, rows) {
  if (!rows.length) return 0;
  await db.sql`
    INSERT INTO search_logs (created_at, search_term, match_found, matched_street, results_count, page, buffer_key)
    SELECT * FROM unnest(
      ${rows.map((r) => r.createdAt)}::timestamptz[],
      ${rows.map((r) => r.searchTerm == null ? null : String(r.searchTerm))}::text[],
      ${rows.map((r) => !!r.matchFound)}::boolean[],
      ${rows.map((r) => r.matchedStreet == null ? null : String(r.matchedStreet))}::text[],
      ${rows.map((r) => Number(r.resultsCount) || 0)}::integer[],
      ${rows.map((r) => r.page || null)}::text[],
      ${rows.map((r) => r.key)}::text[]
    )
    ON CONFLICT (buffer_key) DO NOTHING
  `;
  return rows.length;
}

// Copies buffered records for this deploy context into the database and
// deletes the blobs. Stops starting new chunks once budgetMs has passed
// (what's left is picked up next time), so an admin report never waits
// long. Returns counts; throws only if the database insert fails, in which
// case the blobs are left in place for the next attempt.
export async function flushAnalyticsBuffer(db, ctx, { budgetMs = 5000, blobStore } = {}) {
  const started = Date.now();
  const s = blobStore || store();
  const summary = { events: 0, searches: 0, remaining: false };
  let validSigns = null;

  for (const kind of KINDS) {
    const { blobs } = await s.list({ prefix: ctx + '/' + kind + '/' });
    const keys = blobs.map((b) => b.key).sort();

    for (let i = 0; i < keys.length; i += INSERT_CHUNK) {
      if (Date.now() - started > budgetMs) { summary.remaining = true; return summary; }
      const chunk = keys.slice(i, i + INSERT_CHUNK);
      const loaded = await inParallel(chunk, async (key) => {
        const rec = await s.get(key, { type: 'json' });
        return rec ? Object.assign(rec, { key }) : null;
      });
      const rows = loaded.filter(Boolean);

      if (kind === 'event') {
        if (!validSigns && rows.some((r) => r.eventType === 'qr_sign_visit')) {
          const signRows = await db.sql`SELECT sign_id FROM qr_signs`;
          validSigns = new Set(signRows.map((r) => r.sign_id));
        }
        summary.events += await insertEvents(db, rows, validSigns || new Set());
      } else {
        summary.searches += await insertSearches(db, rows);
      }

      await inParallel(chunk, (key) => s.delete(key).catch((err) => {
        console.error('analytics-buffer: delete failed for ' + key + ':', err.message);
      }));
    }
  }
  return summary;
}

// For the admin reports: flush first so they show everything, but never
// let a flush problem stop the report from loading.
export async function flushBeforeReport(db, context) {
  try {
    const result = await flushAnalyticsBuffer(db, bufferContext(context), { budgetMs: 5000 });
    if (result.remaining) console.log('analytics-buffer: partial flush before report', JSON.stringify(result));
  } catch (err) {
    console.error('analytics-buffer: flush before report failed:', err.message || err);
  }
}
