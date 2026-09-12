-- Phase 8: risk-assessment acknowledgment (per volunteer, timestamped) and
-- the settings backing an admin-editable risk assessment summary/link.
-- No new table for broadcast email / manual reminder send -- both are
-- stateless actions (send-now), nothing to persist beyond the email itself.

ALTER TABLE volunteers ADD COLUMN risk_ack_at TIMESTAMPTZ;

INSERT INTO settings (key, value) VALUES
  ('risk_assessment_text', 'Please take a moment to read our safety guidance before you head out: wear your hi-vis at all times, stay on the pavement and away from the road, never approach or lean into vehicles, keep to your route lead''s instructions, and let your route lead know straight away if you need to stop or need help.'),
  ('risk_assessment_url', '')
ON CONFLICT (key) DO NOTHING;
