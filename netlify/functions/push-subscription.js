// A logged-in, approved volunteer manages push notifications for the
// device they're on (the portal's "Get the app" / "Alerts" dialog).
//
// GET  -> { configured, publicKey, devices }  (devices = how many of their
//         devices have notifications on)
// POST { action: 'subscribe', subscription, deviceLabel? }
//         Saves this device. Also called on every portal load while
//         notifications are on, which refreshes last_seen_at and moves the
//         device to whoever is logged in now (a shared phone).
// POST { action: 'unsubscribe', endpoint }   -- this device off
// POST { action: 'test', endpoint }          -- send a test to this device

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';
import { getVolunteerAccess, notApprovedResponse } from '../lib/volunteer-access.js';
import { cleanSubscription, pushConfigured, sendToSubscriptions, vapidPublicKey } from '../lib/push.js';

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(body, status) {
  return new Response(JSON.stringify(body), { status: status || 200, headers });
}

async function volunteerId(db, user) {
  // Accounts made the old way (Netlify dashboard invite) may not have a row yet.
  await db.sql`
    INSERT INTO volunteers (identity_user_id, email) VALUES (${user.id}, ${user.email})
    ON CONFLICT (identity_user_id) DO NOTHING
  `;
  return (await db.sql`SELECT id FROM volunteers WHERE identity_user_id = ${user.id}`)[0].id;
}

export default async (req) => {
  try {
    const user = await getUser();
    if (!user) return json({ error: 'Not logged in' }, 401);
    const db = getDatabase();
    const access = await getVolunteerAccess(db, user);
    if (access.status !== 'approved') return notApprovedResponse(access.status, headers);

    if (req.method === 'GET') {
      const id = await volunteerId(db, user);
      const rows = await db.sql`SELECT COUNT(*)::int AS n FROM push_subscriptions WHERE volunteer_id = ${id}`;
      return json({ configured: pushConfigured(), publicKey: vapidPublicKey(), devices: rows[0].n });
    }
    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
    if (!pushConfigured()) return json({ error: 'Notifications aren\'t set up on this site yet.' }, 503);

    const body = await req.json().catch(() => ({}));
    const id = await volunteerId(db, user);

    if (body.action === 'subscribe') {
      const sub = cleanSubscription(body.subscription);
      if (!sub) return json({ error: 'That notification subscription wasn\'t valid.' }, 400);
      const label = typeof body.deviceLabel === 'string' ? body.deviceLabel.slice(0, 60) : null;
      await db.sql`
        INSERT INTO push_subscriptions (volunteer_id, endpoint, p256dh, auth, device_label)
        VALUES (${id}, ${sub.endpoint}, ${sub.p256dh}, ${sub.auth}, ${label})
        ON CONFLICT (endpoint) DO UPDATE SET
          volunteer_id = EXCLUDED.volunteer_id,
          p256dh = EXCLUDED.p256dh,
          auth = EXCLUDED.auth,
          device_label = COALESCE(EXCLUDED.device_label, push_subscriptions.device_label),
          last_seen_at = NOW()
      `;
      return json({ success: true });
    }

    if (body.action === 'unsubscribe') {
      if (typeof body.endpoint !== 'string') return json({ error: 'endpoint is required' }, 400);
      await db.sql`DELETE FROM push_subscriptions WHERE endpoint = ${body.endpoint} AND volunteer_id = ${id}`;
      return json({ success: true });
    }

    if (body.action === 'test') {
      if (typeof body.endpoint !== 'string') return json({ error: 'endpoint is required' }, 400);
      const subs = await db.sql`
        SELECT id, volunteer_id, endpoint, p256dh, auth FROM push_subscriptions
        WHERE endpoint = ${body.endpoint} AND volunteer_id = ${id}
      `;
      if (!subs.length) return json({ error: 'Notifications aren\'t on for this device. Turn them on and try again.' }, 404);
      const result = await sendToSubscriptions(db, subs, {
        title: '🎅 Test notification',
        body: "It works! You'll get your shift reminders and any urgent updates here.",
        url: '/volunteer.html',
        tag: 'test'
      }, { ttl: 600, urgency: 'high' });
      if (!result.devicesSent) {
        return json({ error: result.devicesRemoved
          ? 'This device\'s notification setup has expired. Turn notifications on again.'
          : 'The test couldn\'t be sent. Please try again in a minute.' }, 502);
      }
      return json({ success: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (error) {
    console.error('push-subscription error:', error);
    return json({ error: error.message }, 500);
  }
};
