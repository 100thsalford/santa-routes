// Records that the logged-in volunteer has acknowledged the current risk
// assessment / safety guidance (settings.risk_assessment_text /
// risk_assessment_url, admin-editable via Season Settings). Just a
// timestamp on the volunteers row -- no versioning of which text they
// acknowledged, so an admin edit to the wording doesn't currently force
// re-acknowledgment. Requires a valid Netlify Identity JWT.

import { getUser } from '@netlify/identity';
import { getDatabase } from '@netlify/database';

const headers = { 'Content-Type': 'application/json' };

export default async (req, context) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
  }

  try {
    const user = await getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Not logged in' }), { status: 401, headers });
    }

    const db = getDatabase();

    const rows = await db.sql`
      INSERT INTO volunteers (identity_user_id, email, risk_ack_at)
      VALUES (${user.id}, ${user.email}, NOW())
      ON CONFLICT (identity_user_id) DO UPDATE SET risk_ack_at = NOW()
      RETURNING risk_ack_at
    `;

    return new Response(JSON.stringify({ success: true, riskAckAt: rows[0].risk_ack_at }), { status: 200, headers });
  } catch (error) {
    console.error('Error acknowledging risk assessment:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
};
