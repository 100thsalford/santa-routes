// Square Team API helpers for volunteer card-payment access.
//
// Env:
//   SQUARE_ACCESS_TOKEN  production (or sandbox) access token with
//                        EMPLOYEES_READ + EMPLOYEES_WRITE. A personal access
//                        token from the Square Developer Dashboard has both.
//   SQUARE_ENVIRONMENT   'sandbox' to use connect.squareupsandbox.com
//                        (set this on the staging deploy context so testing
//                        never touches the real Square team). Default:
//                        production.
//   SQUARE_LOCATION_ID   optional -- assign new team members to this
//                        location. Without it Square uses the default one.
//
// Square's API can create, find and (de)activate team members, but NOT set
// permissions or passcodes or send the invitation -- the seller does that in
// the Square Dashboard, which then emails the team member.

const SQUARE_VERSION = '2025-01-23';

// Where the admin finishes setup (Staff > Team > Team members).
export const SQUARE_TEAM_DASHBOARD_URL = 'https://app.squareup.com/dashboard/team/team-members';

export const SQUARE_APP_LINKS = {
  ios: 'https://apps.apple.com/gb/app/square-point-of-sale-pos/id335393788',
  android: 'https://play.google.com/store/apps/details?id=com.squareup'
};

export function squareConfigured() {
  return !!process.env.SQUARE_ACCESS_TOKEN;
}

function baseUrl() {
  return String(process.env.SQUARE_ENVIRONMENT || '').toLowerCase() === 'sandbox'
    ? 'https://connect.squareupsandbox.com'
    : 'https://connect.squareup.com';
}

async function squareFetch(path, method, body) {
  const token = process.env.SQUARE_ACCESS_TOKEN;
  if (!token) throw new Error('SQUARE_ACCESS_TOKEN is not set');
  const res = await fetch(baseUrl() + path, {
    method,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Square-Version': SQUARE_VERSION,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = (data.errors || []).map((e) => e.detail || e.code).join('; ') || ('HTTP ' + res.status);
    const err = new Error('Square: ' + detail);
    err.squareErrors = data.errors || [];
    throw err;
  }
  return data;
}

// Every team member, active and inactive (our team is small, so a full
// scan is fine and lets us match on email, which search can't filter by).
async function findTeamMemberByEmail(email) {
  const target = String(email || '').trim().toLowerCase();
  let cursor;
  do {
    const data = await squareFetch('/v2/team-members/search', 'POST', { limit: 200, cursor });
    for (const m of data.team_members || []) {
      if (String(m.email_address || '').trim().toLowerCase() === target) return m;
    }
    cursor = data.cursor;
  } while (cursor);
  return null;
}

export async function setTeamMemberStatus(id, status) {
  const data = await squareFetch('/v2/team-members/' + encodeURIComponent(id), 'PUT', {
    team_member: { status }
  });
  return data.team_member;
}

// Re-uses an existing team member with the same email (e.g. from last
// season), re-activating them if needed; otherwise creates a new one.
// The account owner is never touched.
export async function findOrCreateTeamMember({ volunteerId, fullName, email }) {
  const existing = await findTeamMemberByEmail(email);
  if (existing) {
    if (existing.is_owner) throw new Error('That email belongs to the Square account owner');
    if (existing.status !== 'ACTIVE') return { member: await setTeamMemberStatus(existing.id, 'ACTIVE'), reused: true };
    return { member: existing, reused: true };
  }

  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  const teamMember = {
    reference_id: 'santa-volunteer-' + volunteerId,
    status: 'ACTIVE',
    given_name: parts.length ? parts[0] : 'Volunteer',
    email_address: email
  };
  if (parts.length > 1) teamMember.family_name = parts.slice(1).join(' ');
  if (process.env.SQUARE_LOCATION_ID) {
    teamMember.assigned_locations = {
      assignment_type: 'EXPLICIT_LOCATIONS',
      location_ids: [process.env.SQUARE_LOCATION_ID]
    };
  }

  const data = await squareFetch('/v2/team-members', 'POST', {
    idempotency_key: crypto.randomUUID(),
    team_member: teamMember
  });
  return { member: data.team_member, reused: false };
}

// Card-payment access state for one volunteer, as shown in the portal.
// eligible: signed up (shift or Santa/Safety Walker/Driver slot) to a night
// that hasn't happened yet.
export async function squareAccessState(db, volunteerId) {
  const rows = await db.sql`
    SELECT v.square_requested_at, v.square_approved_at, v.square_email,
      EXISTS (
        SELECT 1 FROM shift_assignments sa JOIN route_dates rd ON rd.id = sa.route_date_id
        WHERE sa.volunteer_id = v.id AND rd.event_date >= CURRENT_DATE
      ) OR EXISTS (
        SELECT 1 FROM event_role_assignments era JOIN route_dates rd ON rd.id = era.route_date_id
        WHERE era.volunteer_id = v.id AND rd.event_date >= CURRENT_DATE
      ) AS eligible
    FROM volunteers v WHERE v.id = ${volunteerId}
  `;
  if (!rows.length) return { status: 'none', eligible: false };
  const r = rows[0];
  return {
    status: r.square_approved_at ? 'approved' : (r.square_requested_at ? 'requested' : 'none'),
    eligible: !!r.eligible,
    email: r.square_email || null,
    requestedAt: r.square_requested_at,
    approvedAt: r.square_approved_at,
    available: squareConfigured()
  };
}
