-- Field monitoring: reviewer decision per submission (kept across Kobo re-syncs)
--   auto = default, valid = checked and OK (flags acknowledged), recheck = send back to field, test = test/dummy record (excluded everywhere)
ALTER TABLE submissions ADD COLUMN field_status TEXT DEFAULT 'auto';
ALTER TABLE submissions ADD COLUMN field_note TEXT;
CREATE INDEX IF NOT EXISTS idx_sub_form ON submissions(form_uid);
CREATE INDEX IF NOT EXISTS idx_sub_enum ON submissions(enumerator_id);
