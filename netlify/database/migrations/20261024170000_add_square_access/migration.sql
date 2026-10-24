-- Square card-payment access requests (2026-10-24).
--
-- A volunteer signed up to an upcoming night can ask for access to take
-- card payments with the Square Point of Sale app (Tap to Pay on their own
-- phone). volunteer-square-access.js creates them as a Square team member
-- through the Team API; an admin then assigns their permission set and
-- passcode in the Square Dashboard (Square's API can't do that part) and
-- presses "Mark approved" on the admin Volunteers tab.
--
-- square_team_member_id: the Square TeamMember id we created or re-used.
-- square_email:          the address Square will send its invitation to.
-- square_requested_at:   when the volunteer asked (NULL = never/revoked).
-- square_approved_at:    when an admin marked them set up in Square.
ALTER TABLE volunteers
  ADD COLUMN IF NOT EXISTS square_team_member_id TEXT,
  ADD COLUMN IF NOT EXISTS square_email TEXT,
  ADD COLUMN IF NOT EXISTS square_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS square_approved_at TIMESTAMPTZ;
