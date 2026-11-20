CREATE TABLE IF NOT EXISTS forms (
  uid TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'kii',          -- kii | fgd
  name TEXT,
  schema TEXT,                                -- trimmed survey definition (json)
  last_sync TEXT,
  submission_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY,                     -- KoboToolbox _id (demo rows use negative ids)
  form_uid TEXT,
  uuid TEXT,
  kind TEXT DEFAULT 'kii',
  submitted_at TEXT,
  started_at TEXT,
  ended_at TEXT,
  duration_sec INTEGER,
  interview_date TEXT,
  region TEXT,
  lg TEXT,
  lg_category TEXT,
  affiliation TEXT,
  grp TEXT,                                   -- official | trader
  enumerator_id TEXT,
  consent_interview TEXT,
  consent_audio TEXT,
  lat REAL,
  lon REAL,
  answers TEXT,                               -- non-free-text answers (json)
  texts TEXT,                                 -- free-text answers (json)
  text_words INTEGER DEFAULT 0,
  photo_count INTEGER DEFAULT 0,
  audio_url TEXT,
  audio_name TEXT,
  audio_status TEXT DEFAULT 'none',           -- none | pending | processing | done | failed | declined
  validation TEXT,
  is_demo INTEGER DEFAULT 0,
  synced_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sub_lg ON submissions(lg);
CREATE INDEX IF NOT EXISTS idx_sub_audio ON submissions(audio_status);

CREATE TABLE IF NOT EXISTS transcripts (
  submission_id INTEGER PRIMARY KEY,
  text TEXT,
  segments TEXT,                              -- json [{start,end,text}]
  language TEXT,
  engine TEXT,
  model TEXT,
  confidence REAL,                            -- 0..1 mean segment confidence
  duration REAL,
  status TEXT,
  error TEXT,
  flags TEXT,                                 -- json list: repetition, low_confidence, little_speech ...
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL,
  source TEXT NOT NULL,                       -- field:<name> | audio
  seg_start REAL,
  theme TEXT NOT NULL,
  dimension TEXT NOT NULL,
  objective TEXT,
  polarity TEXT,                              -- positive | negative | mixed | neutral
  evidence TEXT,                              -- documented | observed | reported | inferred
  method TEXT,                                -- keyword | field
  excerpt TEXT,
  lg TEXT, region TEXT, grp TEXT, kind TEXT,
  is_demo INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_codes_sub ON codes(submission_id);
CREATE INDEX IF NOT EXISTS idx_codes_theme ON codes(theme);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
