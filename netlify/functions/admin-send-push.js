// Admin "Send a push notification now" -- an urgent, push-only message
// (meeting point moved, weather cancellation, running late) to volunteers'
// phones. Only reaches volunteers who have turned notifications on; use the
// broadcast email for everyone else.
//
// POST body: { title, message, scope: 'all' | 'tonight' | 'event' | 'no_upcoming', routeDateId? }
// { scope, routeDateId?, preview: true } sends nothing and returns how many
// of that audience have notifications on.
// Audiences: lib/broadcast-audience.js (the same as the broadcast email).

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { SCOPES, displayName, findRecipients } from '../lib/broadcast-audience.js';
import { BODY_MAX, TITLE_MAX, pushConfigured, sendPushToVolunteers } from '../lib/push.js';

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers });
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const user = await getUser();
    if (!(user && user.roles && user.roles.includes('admin'))) return json({ error: 'Admin access required' }, 403);

    const body = await req.json().catch(() => ({}));
    const scope = body.scope;
    if (!SCOPES.includes(scope)) return json({ error: 'Unknown scope' }, 400);
    if (scope === 'event' && !body.routeDateId) return json({ error: 'Pick which date' }, 400);

    const db = getDatabase();
    const recipients = await findRecipients(db, scope, body.routeDateId);
    const ids = recipients.map((r) => r.id);
    const withPush = ids.length ? await db.sql`
      SELECT volunteer_id, COUNT(*)::int AS devices FROM push_subscriptions
      WHERE volunteer_id = ANY(${ids}) GROUP BY volunteer_id
    ` : [];
    const pushIds = new Set(withPush.map((r) => r.volunteer_id));

    if (body.preview === true) {
      return json({
        configured: pushConfigured(),
        audienceCount: recipients.length,
        pushCount: pushIds.size,
        deviceCount: withPush.reduce((n, r) => n + r.devices, 0),
        withoutPush: recipients.filter((r) => !pushIds.has(r.id)).map(displayName)
      });
    }

    if (!pushConfigured()) return json({ error: "Push notifications aren't set up yet (VAPID keys missing)." }, 503);
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!title || !message) return json({ error: 'Title and message are both needed' }, 400);
    if (title.length > TITLE_MAX) return json({ error: 'Title must be ' + TITLE_MAX + ' characters or fewer' }, 400);
    if (message.length > BODY_MAX) return json({ error: 'Message must be ' + BODY_MAX + ' characters or fewer' }, 400);

    const result = await sendPushToVolunteers(db, ids,
      { title, body: message, url: '/volunteer.html', tag: 'urgent-' + Date.now() },
      { ttl: 4 * 3600, urgency: 'high' });

    return json(Object.assign({ success: true, audienceCount: recipients.length }, result));
  } catch (error) {
    console.error('admin-send-push error:', error);
    return json({ error: error.message }, 500);
  }
};
