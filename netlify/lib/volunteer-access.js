// Shared approval check for volunteer-facing functions.
//
// A volunteer who registered themselves on the helpout page sits at
// approval_status = 'pending' until an admin approves them (or
// 'rejected'). They can log in, but must not see shift details, names,
// route maps or claim shifts until approved.
//
// No volunteers row yet = approved: every helpout/invite registration
// inserts its row (as pending or approved) before the person can ever log
// in, so a missing row can only be an account made the old way via the
// Netlify dashboard invite. Admins are always treated as approved.

export async function getVolunteerAccess(db, user) {
  if (!user) return { status: null, volunteerId: null };
  const isAdmin = !!(user.roles && user.roles.includes('admin'));
  const rows = await db.sql`SELECT id, approval_status FROM volunteers WHERE identity_user_id = ${user.id}`;
  if (rows.length === 0) return { status: 'approved', volunteerId: null };
  return {
    status: isAdmin ? 'approved' : rows[0].approval_status,
    volunteerId: rows[0].id
  };
}

export function notApprovedResponse(status, headers) {
  const message = status === 'rejected'
    ? "Your volunteer registration wasn't approved. Please get in touch if you think this is a mistake."
    : "Your volunteer registration is waiting for approval. We'll email you as soon as you're approved.";
  return new Response(JSON.stringify({ error: 'not_approved', approvalStatus: status, message }), {
    status: 403,
    headers: headers || { 'Content-Type': 'application/json' }
  });
}
