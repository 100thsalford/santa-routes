// Public endpoint for the helpout page (helpout.html):
//   GET                -> { open }  (is self-registration open, i.e. is a
//                          sign-up code set? the code itself is never sent)
//   GET ?invite=TOKEN  -> also { invite: { valid, email, fullName } } or
//                          { invite: { valid: false, reason } }
// so the page can lock the email field and skip the sign-up code for a
// branded admin invite (admin-invite-volunteer.js).

import { getDatabase } from '@netlify/database';
import { createHash } from 'node:crypto';
import { corsHeaders } from '../lib/helpout-cors.js';

export default async (req, context) => {
  const headers = corsHeaders(req, 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers });

  try {
    const db = getDatabase();
    const codeRows = await db.sql`SELECT value FROM settings WHERE key = 'signup_code'`;
    const open = !!(codeRows.length && String(codeRows[0].value || '').trim());

    const result = { open };

    const token = new URL(req.url).searchParams.get('invite');
    if (token) {
      const hash = createHash('sha256').update(token).digest('hex');
      const rows = await db.sql`
        SELECT email, full_name, used_at, cancelled_at, expires_at < NOW() AS expired
        FROM volunteer_invites WHERE token_hash = ${hash}
      `;
      if (rows.length === 0 || rows[0].cancelled_at) {
        result.invite = { valid: false, reason: 'invalid' };
      } else if (rows[0].used_at) {
        result.invite = { valid: false, reason: 'used' };
      } else if (rows[0].expired) {
        result.invite = { valid: false, reason: 'expired' };
      } else {
        result.invite = { valid: true, email: rows[0].email, fullName: rows[0].full_name || '' };
      }
    }

    return new Response(JSON.stringify(result), { status: 200, headers });
  } catch (error) {
    console.error('Error fetching helpout status:', error);
    return new Response(JSON.stringify({ error: 'Something went wrong' }), { status: 500, headers });
  }
};
