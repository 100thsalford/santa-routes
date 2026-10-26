// Admin "QR Signs" tab: the per-season sign register plus tracked QR link
// visit reports. Requires a logged-in Identity user with the 'admin' role
// -- sign locations and visit counts are never exposed publicly.
//
// GET  ?season=2026[&from=YYYY-MM-DD&to=YYYY-MM-DD][&sign=023][&includeTest=1]
//      -> register rows for that season, per-sign visit counts, daily counts.
//      A season runs 1 Aug to 31 Jul and is named by its starting year.
//      Visits are analytics_events rows (event_type 'qr_sign_visit'),
//      recorded only for visitors whose analytics preference allows it, so
//      these are tracked link visits -- not people, scans or donations.
//      Dates are grouped in Europe/London time.
// POST {op:'save-placement', season, signId, locationLabel, status,
//       installedDate, removedDate, notes}
//      {op:'import', season, rows:[{sign_id, location, status,
//       installed_date, removed_date, notes}]}
//      {op:'clear-notes', season}

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const STATUSES = ['not_installed', 'installed', 'removed'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function requireAdmin(user) {
  return !!(user && user.roles && user.roles.includes('admin'));
}

function json(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers });
}

function londonToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
}

function currentSeason() {
  const [y, m] = londonToday().split('-').map(Number);
  return m >= 8 ? y : y - 1;
}

function validSeason(v) {
  const n = Number(v);
  return Number.isInteger(n) && n >= 2020 && n <= 2100 ? n : null;
}

function validDate(v) {
  if (!v || !DATE_RE.test(v)) return null;
  const d = new Date(v + 'T00:00:00Z');
  return isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

function cleanText(v, max) {
  const s = String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

function daysBetween(a, b) { // inclusive, YYYY-MM-DD strings
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000) + 1;
}

function toDateStr(v) {
  if (!v) return null;
  if (typeof v === 'string') return v.slice(0, 10);
  const d = new Date(v);
  // DATE columns come back as local-midnight Date objects; read them back
  // with local getters so no timezone shift is introduced.
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function upsertPlacement(db, season, p) {
  await db.sql`
    INSERT INTO qr_sign_placements
      (sign_id, season, location_label, status, installed_date, removed_date, notes, updated_at)
    VALUES (${p.signId}, ${season}, ${p.locationLabel}, ${p.status},
            ${p.installedDate}::date, ${p.removedDate}::date, ${p.notes}, NOW())
    ON CONFLICT (sign_id, season) DO UPDATE SET
      location_label = EXCLUDED.location_label,
      status = EXCLUDED.status,
      installed_date = EXCLUDED.installed_date,
      removed_date = EXCLUDED.removed_date,
      notes = EXCLUDED.notes,
      updated_at = NOW()
  `;
}

// Validates one placement; returns {error} or the cleaned placement.
function cleanPlacement(raw, knownSigns) {
  const signId = String(raw.signId || '').trim();
  if (!knownSigns.has(signId)) return { error: 'Unknown sign ' + signId };
  const installedDate = raw.installedDate ? validDate(String(raw.installedDate).trim()) : null;
  const removedDate = raw.removedDate ? validDate(String(raw.removedDate).trim()) : null;
  if (raw.installedDate && !installedDate) return { error: 'Sign ' + signId + ': installed date must be YYYY-MM-DD' };
  if (raw.removedDate && !removedDate) return { error: 'Sign ' + signId + ': removed date must be YYYY-MM-DD' };
  if (installedDate && removedDate && removedDate < installedDate) {
    return { error: 'Sign ' + signId + ': removed date is before installed date' };
  }
  let status = String(raw.status || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!status) status = removedDate ? 'removed' : (installedDate ? 'installed' : 'not_installed');
  if (!STATUSES.includes(status)) return { error: 'Sign ' + signId + ': unknown status' };
  return {
    signId,
    status,
    installedDate,
    removedDate,
    locationLabel: cleanText(raw.locationLabel, 120),
    notes: cleanText(raw.notes, 500)
  };
}

async function knownSignIds(db) {
  const rows = await db.sql`SELECT sign_id FROM qr_signs`;
  return new Set(rows.map((r) => r.sign_id));
}

async function handleGet(db, url) {
  const season = validSeason(url.searchParams.get('season')) || currentSeason();
  const seasonFrom = season + '-08-01';
  const seasonTo = (season + 1) + '-07-31';
  let from = validDate(url.searchParams.get('from')) || seasonFrom;
  let to = validDate(url.searchParams.get('to')) || seasonTo;
  if (to < from) { const t = from; from = to; to = t; }
  const signParam = url.searchParams.get('sign');
  const sign = signParam && /^\d{3}$/.test(signParam) ? signParam : null;
  const includeTest = url.searchParams.get('includeTest') === '1';

  const [signRows, visitRows, dailyRows, testRows] = await Promise.all([
    db.sql`
      SELECT s.sign_id, p.location_label, COALESCE(p.status, 'not_installed') AS status,
             p.installed_date, p.removed_date, p.notes, p.updated_at
      FROM qr_signs s
      LEFT JOIN qr_sign_placements p ON p.sign_id = s.sign_id AND p.season = ${season}
      ORDER BY s.sign_id
    `,
    db.sql`
      SELECT event_data->>'sign_id' AS sign_id, COUNT(*) AS visits, MAX(created_at) AS last_visit
      FROM analytics_events
      WHERE event_type = 'qr_sign_visit'
        AND (created_at AT TIME ZONE 'Europe/London')::date BETWEEN ${from}::date AND ${to}::date
        AND (${includeTest} OR COALESCE(event_data->>'test', 'false') <> 'true')
      GROUP BY 1
    `,
    db.sql`
      SELECT to_char((created_at AT TIME ZONE 'Europe/London')::date, 'YYYY-MM-DD') AS day,
             COUNT(*) AS visits
      FROM analytics_events
      WHERE event_type = 'qr_sign_visit'
        AND (created_at AT TIME ZONE 'Europe/London')::date BETWEEN ${from}::date AND ${to}::date
        AND (${includeTest} OR COALESCE(event_data->>'test', 'false') <> 'true')
        AND (${sign}::text IS NULL OR event_data->>'sign_id' = ${sign}::text)
      GROUP BY 1
      ORDER BY 1
    `,
    db.sql`
      SELECT COUNT(*) AS n
      FROM analytics_events
      WHERE event_type = 'qr_sign_visit' AND event_data->>'test' = 'true'
        AND (created_at AT TIME ZONE 'Europe/London')::date BETWEEN ${from}::date AND ${to}::date
    `
  ]);

  const visitsBySign = new Map(visitRows.map((r) => [r.sign_id, r]));
  const today = londonToday();

  const signs = signRows.map((r) => {
    const v = visitsBySign.get(r.sign_id);
    const installedDate = toDateStr(r.installed_date);
    const removedDate = toDateStr(r.removed_date);
    // Days the sign was up within the selected range (for fairer
    // comparisons between signs installed at different times).
    let daysInstalled = null;
    if (installedDate) {
      const start = installedDate > from ? installedDate : from;
      let end = removedDate || today;
      if (end > to) end = to;
      daysInstalled = end >= start ? daysBetween(start, end) : 0;
    }
    const visits = v ? Number(v.visits) : 0;
    return {
      signId: r.sign_id,
      qrUrl: 'https://santasleighsalford.co.uk/s/' + r.sign_id,
      locationLabel: r.location_label || '',
      status: r.status,
      installedDate,
      removedDate,
      notes: r.notes || '',
      visits,
      lastVisit: v ? v.last_visit : null,
      daysInstalled,
      visitsPerDayInstalled: daysInstalled ? Math.round((visits / daysInstalled) * 100) / 100 : null
    };
  });

  const installed = signs.filter((s) => s.status === 'installed');
  return json({
    season,
    seasonFrom,
    seasonTo,
    from,
    to,
    sign,
    includeTest,
    currentSeason: currentSeason(),
    totals: {
      trackedVisits: signs.reduce((n, s) => n + s.visits, 0),
      signsWithVisits: signs.filter((s) => s.visits > 0).length,
      totalSigns: signs.length,
      installedSigns: installed.length,
      installedWithVisits: installed.filter((s) => s.visits > 0).length,
      testVisits: Number((testRows[0] && testRows[0].n) || 0)
    },
    signs,
    daily: dailyRows.map((r) => ({ day: r.day, visits: Number(r.visits) }))
  });
}

async function handlePost(db, req) {
  const body = await req.json();
  const season = validSeason(body.season);
  if (!season) return json({ error: 'A valid season year is required' }, 400);

  if (body.op === 'clear-notes') {
    const rows = await db.sql`
      UPDATE qr_sign_placements SET notes = NULL, updated_at = NOW()
      WHERE season = ${season} AND notes IS NOT NULL RETURNING id
    `;
    return json({ success: true, cleared: rows.length });
  }

  const known = await knownSignIds(db);

  if (body.op === 'save-placement') {
    const p = cleanPlacement(body, known);
    if (p.error) return json({ error: p.error }, 400);
    await upsertPlacement(db, season, p);
    return json({ success: true });
  }

  if (body.op === 'import') {
    if (!Array.isArray(body.rows) || body.rows.length > 500) {
      return json({ error: 'Expected up to 500 rows' }, 400);
    }
    // Validate everything first, so a bad file changes nothing.
    const cleaned = [];
    let skipped = 0;
    for (const raw of body.rows) {
      const signId = String(raw.sign_id || '').trim().padStart(3, '0');
      const hasContent = ['location', 'status', 'installed_date', 'removed_date', 'notes']
        .some((k) => String(raw[k] || '').trim() !== '');
      if (!hasContent) { skipped++; continue; } // e.g. the blank print manifest
      const p = cleanPlacement({
        signId,
        locationLabel: raw.location,
        status: raw.status,
        installedDate: raw.installed_date,
        removedDate: raw.removed_date,
        notes: raw.notes
      }, known);
      if (p.error) return json({ error: p.error + ' (nothing imported)' }, 400);
      cleaned.push(p);
    }
    for (const p of cleaned) await upsertPlacement(db, season, p);
    return json({ success: true, imported: cleaned.length, skipped });
  }

  return json({ error: 'Unknown operation' }, 400);
}

export default async (req) => {
  try {
    const user = await getUser();
    if (!requireAdmin(user)) return json({ error: 'Admin access required' }, 403);
    const db = getDatabase();
    if (req.method === 'GET') return await handleGet(db, new URL(req.url));
    if (req.method === 'POST') return await handlePost(db, req);
    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    console.error('admin-qr-signs error:', error);
    return json({ error: 'Something went wrong loading QR sign data' }, 500);
  }
};
