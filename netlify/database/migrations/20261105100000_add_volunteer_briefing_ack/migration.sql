-- Volunteer Briefing video acknowledgement (2026-11-05).
--
-- briefing_ack_at: when this volunteer confirmed they'd watched the video
--   in the portal. NULL = not yet, so every existing volunteer sees it once
--   after the safety guidance on their next login.
ALTER TABLE volunteers ADD COLUMN IF NOT EXISTS briefing_ack_at TIMESTAMPTZ;
