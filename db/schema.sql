-- DMU Parliamentary Intelligence Tool — SQLite schema
-- All dates stored as ISO 8601 strings.

-- ========================= Core parliamentary tables =========================

CREATE TABLE IF NOT EXISTS parliamentary_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT NOT NULL,            -- Commons | Lords | Written Q | Committee
  type          TEXT,                     -- debate type / question | answer | statement
  keyword_group TEXT,
  title         TEXT,
  member_name   TEXT,
  party         TEXT,
  house         TEXT,
  date          TEXT,
  snippet       TEXT,
  full_text     TEXT,
  url           TEXT UNIQUE,
  is_new        INTEGER DEFAULT 0,
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS diary_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id   TEXT,
  date          TEXT,
  house         TEXT,
  event_type    TEXT,
  title         TEXT,
  description   TEXT,
  location      TEXT,
  url           TEXT,
  keyword_group TEXT,
  keyword_match INTEGER DEFAULT 0,
  is_new        INTEGER DEFAULT 0,
  content_hash  TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  UNIQUE(external_id)
);

CREATE TABLE IF NOT EXISTS committee_inquiries (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id            TEXT UNIQUE,
  committee_name         TEXT,
  inquiry_title          TEXT,
  date_opened            TEXT,
  deadline               TEXT,
  working_days_remaining INTEGER,
  summary                TEXT,
  url                    TEXT,
  is_new                 INTEGER DEFAULT 0,
  evidence_status        TEXT,
  submitted              INTEGER DEFAULT 0,
  contributors           TEXT,
  submission_url         TEXT,
  keyword_group          TEXT,
  created_at             TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS external_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id     TEXT,
  source_name   TEXT,
  source_type   TEXT,                     -- he_news | professional_body | outlet | legislation | bill | edm | petition
  title         TEXT,
  date          TEXT,
  url           TEXT UNIQUE,
  summary       TEXT,
  keyword_groups TEXT,
  meta_json     TEXT,                      -- extra fields (signature counts, bill stage, etc.)
  created_at    TEXT DEFAULT (datetime('now'))
);

-- Committees roster (the standing/select committees themselves, not inquiries).
CREATE TABLE IF NOT EXISTS committees (
  id            INTEGER PRIMARY KEY,
  name          TEXT,
  house         TEXT,
  category      TEXT,
  departments   TEXT,
  members_json  TEXT,
  studies_json  TEXT,
  relevant      INTEGER DEFAULT 0,
  url           TEXT,
  last_scraped  TEXT
);

-- Government consultations (GOV.UK Search API) — response opportunities with
-- deadlines, tracked much like committee inquiries.
CREATE TABLE IF NOT EXISTS consultations (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  external_id            TEXT UNIQUE,
  title                  TEXT,
  organisation           TEXT,
  summary                TEXT,
  url                    TEXT,
  opened                 TEXT,
  deadline               TEXT,
  working_days_remaining INTEGER,
  keyword_group          TEXT,
  is_new                 INTEGER DEFAULT 0,
  submitted              INTEGER DEFAULT 0,
  contributors           TEXT,
  submission_url         TEXT,
  created_at             TEXT DEFAULT (datetime('now'))
);

-- ========================= DMU tables =========================

CREATE TABLE IF NOT EXISTS academics (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  contensis_id     TEXT UNIQUE,
  name             TEXT,
  title            TEXT,
  department       TEXT,
  faculty          TEXT,
  email            TEXT,
  phone            TEXT,
  profile_url      TEXT,
  profile_text     TEXT,
  research_group   TEXT,
  publications_json TEXT,
  raw_json         TEXT,
  last_scraped     TEXT,
  created_at       TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS courses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  contensis_id TEXT UNIQUE,
  title        TEXT,
  award        TEXT,
  level        TEXT,
  school       TEXT,
  department   TEXT,
  url          TEXT,
  study_mode   TEXT,
  description  TEXT,
  keywords     TEXT,
  raw_json     TEXT,
  last_scraped TEXT
);

CREATE TABLE IF NOT EXISTS research_projects (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  contensis_id     TEXT UNIQUE,
  title            TEXT,
  description      TEXT,
  lead_academic_id INTEGER,
  keywords         TEXT,
  url              TEXT,
  raw_json         TEXT,
  last_scraped     TEXT
);

CREATE TABLE IF NOT EXISTS dmu_events (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  contensis_id TEXT UNIQUE,
  title        TEXT,
  description  TEXT,
  date         TEXT,
  end_date     TEXT,
  location     TEXT,
  url          TEXT,
  keywords     TEXT,
  raw_json     TEXT,
  last_scraped TEXT
);

CREATE TABLE IF NOT EXISTS event_matches (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    INTEGER,
  item_type  TEXT,
  event_id   INTEGER,
  score      REAL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(item_id, item_type, event_id)
);

-- UKRI Gateway to Research — DMU's actual funded projects (for evidence in drafts).
CREATE TABLE IF NOT EXISTS grants (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  gtr_id        TEXT UNIQUE,
  title         TEXT,
  abstract      TEXT,
  funder        TEXT,
  lead_org      TEXT,
  value         REAL,
  start_date    TEXT,
  end_date      TEXT,
  url           TEXT,
  keyword_groups TEXT,
  last_scraped  TEXT
);

-- SDG -> keyword-group mapping (DMU is UN hub for SDG 11).
CREATE TABLE IF NOT EXISTS sdg_keyword_map (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sdg           TEXT,
  keyword_group TEXT,
  UNIQUE(sdg, keyword_group)
);

-- Petition signature trajectory.
CREATE TABLE IF NOT EXISTS petition_signatures (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  petition_url TEXT,
  signatures  INTEGER,
  recorded_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_petsig_url ON petition_signatures(petition_url, recorded_at);

CREATE TABLE IF NOT EXISTS professional_bodies (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT,
  url                 TEXT,
  feed_url            TEXT,
  scrape_selectors    TEXT,    -- JSON CSS selector config
  departments_json    TEXT,
  keyword_groups_json TEXT
);

CREATE TABLE IF NOT EXISTS external_sources (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT,
  source_type   TEXT,
  feed_url      TEXT,
  scrape_url    TEXT,
  scrape_selectors TEXT,
  refresh       TEXT
);

CREATE TABLE IF NOT EXISTS dmu_context (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  key          TEXT UNIQUE,
  value        TEXT,
  last_updated TEXT DEFAULT (datetime('now'))
);

-- ========================= Keyword groups =========================

CREATE TABLE IF NOT EXISTS keyword_groups (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  name     TEXT UNIQUE,
  keywords TEXT     -- comma separated
);

-- ========================= People tables =========================

CREATE TABLE IF NOT EXISTS mps (
  id           INTEGER PRIMARY KEY,
  first_name   TEXT,
  last_name    TEXT,
  party        TEXT,
  constituency TEXT,
  email        TEXT,
  phone        TEXT,
  photo_url    TEXT,
  notes        TEXT,
  is_active    INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS academics_legacy (
  id          INTEGER PRIMARY KEY,
  name        TEXT,
  title       TEXT,
  department  TEXT,
  interest_a  TEXT,
  interest_b  TEXT,
  interest_c  TEXT,
  email       TEXT,
  phone       TEXT,
  profile_url TEXT,
  norm_name   TEXT
);

CREATE TABLE IF NOT EXISTS engagement_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mp_id       INTEGER,
  academic_id INTEGER,
  date        TEXT,
  type        TEXT,
  description TEXT,
  notes       TEXT,
  followup    INTEGER DEFAULT 0,
  item_id     INTEGER
);

-- ========================= Matching tables =========================

CREATE TABLE IF NOT EXISTS academic_matches (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id     INTEGER,
  item_type   TEXT,     -- parliamentary_item | committee_inquiry | external_item
  academic_id INTEGER,
  score       REAL,
  match_type  TEXT,     -- keyword | semantic
  confidence  TEXT,     -- high | medium | low (semantic)
  explanation TEXT,
  created_at  TEXT DEFAULT (datetime('now')),
  UNIQUE(item_id, item_type, academic_id, match_type)
);

CREATE TABLE IF NOT EXISTS course_matches (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id    INTEGER,
  item_type  TEXT,
  course_id  INTEGER,
  score      REAL,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(item_id, item_type, course_id)
);

CREATE TABLE IF NOT EXISTS fetch_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  source        TEXT,
  started_at    TEXT,
  completed_at  TEXT,
  items_fetched INTEGER DEFAULT 0,
  items_new     INTEGER DEFAULT 0,
  error         TEXT
);

-- ========================= MP profile caches =========================

CREATE TABLE IF NOT EXISTS mp_cache (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mp_id       INTEGER,
  cache_type  TEXT,     -- divisions | interests
  data_json   TEXT,
  fetched_at  TEXT,
  UNIQUE(mp_id, cache_type)
);

-- Saved drafts — turns the generator into a record. Each generation is a new
-- row (version history); manual edits update the latest.
CREATE TABLE IF NOT EXISTS drafts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  item_type   TEXT,
  item_id     INTEGER,
  output_type TEXT,
  mp_id       INTEGER,
  item_title  TEXT,
  content     TEXT,
  status      TEXT DEFAULT 'generated',   -- generated | edited | approved | sent
  created_at  TEXT DEFAULT (datetime('now')),
  updated_at  TEXT DEFAULT (datetime('now'))
);

-- Per-item triage state (flag for VC / ignore / read).
CREATE TABLE IF NOT EXISTS item_flags (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  item_type  TEXT,
  item_id    INTEGER,
  flagged    INTEGER DEFAULT 0,
  ignored    INTEGER DEFAULT 0,
  read       INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(item_type, item_id)
);

-- Match feedback — thumbs up/down accumulate per academic + topic to tune scoring.
CREATE TABLE IF NOT EXISTS academic_feedback (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  academic_id   INTEGER,
  keyword_group TEXT,
  votes         INTEGER DEFAULT 0,
  UNIQUE(academic_id, keyword_group)
);

-- ========================= Background task queue =========================
-- Drives intelligent, background processing (contextual relevance scoring).
CREATE TABLE IF NOT EXISTS task_queue (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  kind         TEXT NOT NULL,            -- e.g. 'relevance'
  item_type    TEXT NOT NULL,
  item_id      INTEGER NOT NULL,
  priority     INTEGER DEFAULT 5,        -- lower = sooner
  status       TEXT DEFAULT 'pending',   -- pending | done | error
  attempts     INTEGER DEFAULT 0,
  error        TEXT,
  created_at   TEXT DEFAULT (datetime('now')),
  processed_at TEXT,
  UNIQUE(kind, item_type, item_id)
);

-- General DMU website content of policy/public-affairs interest (SDG,
-- engagement, policy pages) scraped from the public site (Contensis API blocked).
CREATE TABLE IF NOT EXISTS dmu_content (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  url           TEXT UNIQUE,
  section       TEXT,        -- course | research | sdg | news | event | engagement | other
  title         TEXT,
  summary       TEXT,
  body          TEXT,
  keyword_groups TEXT,
  last_scraped  TEXT
);

-- ========================= University Alliance peers =========================
-- Monitor fellow University Alliance members' public affairs activity
-- (benchmarking — kept separate from DMU's own relevance pipeline).
CREATE TABLE IF NOT EXISTS ua_members (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  name      TEXT UNIQUE,
  short     TEXT,
  domain    TEXT,
  feed_url  TEXT,
  region    TEXT,
  is_self   INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ua_activity (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  member     TEXT,
  type       TEXT,          -- news | hansard | written
  title      TEXT,
  date       TEXT,
  url        TEXT UNIQUE,
  snippet    TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_uaact_member ON ua_activity(member, date);

-- ========================= APPGs =========================
-- All-Party Parliamentary Groups (scraped register — no API). Matched groups
-- become an engagement route via their officer MPs.
CREATE TABLE IF NOT EXISTS appgs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT UNIQUE,
  url           TEXT,
  purpose       TEXT,
  officers_json TEXT,
  secretariat   TEXT,
  keyword_group TEXT,
  matched       INTEGER DEFAULT 0,
  last_scraped  TEXT,
  created_at    TEXT DEFAULT (datetime('now'))
);

-- ========================= Think tanks =========================
CREATE TABLE IF NOT EXISTS think_tanks (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  name                TEXT UNIQUE,
  url                 TEXT,
  feed_url            TEXT,
  scrape_selectors    TEXT,
  status              TEXT DEFAULT 'unvalidated', -- unvalidated | active | dead | needs_url
  keyword_groups_json TEXT,
  last_checked        TEXT,
  last_hit            TEXT,
  hit_count           INTEGER DEFAULT 0,
  miss_streak         INTEGER DEFAULT 0
);

-- ========================= Indexes =========================
CREATE INDEX IF NOT EXISTS idx_queue_status ON task_queue(status, priority);

CREATE INDEX IF NOT EXISTS idx_parl_group ON parliamentary_items(keyword_group);
CREATE INDEX IF NOT EXISTS idx_parl_date  ON parliamentary_items(date);
CREATE INDEX IF NOT EXISTS idx_parl_member ON parliamentary_items(member_name);
CREATE INDEX IF NOT EXISTS idx_diary_date ON diary_events(date);
CREATE INDEX IF NOT EXISTS idx_ext_type   ON external_items(source_type);
CREATE INDEX IF NOT EXISTS idx_match_item ON academic_matches(item_id, item_type);
CREATE INDEX IF NOT EXISTS idx_cmatch_item ON course_matches(item_id, item_type);

-- ========================= DMU public-affairs events =========================
-- Events the PA team runs (roundtables, receptions, briefings) with a curated
-- invite list assembled from the tool's stakeholder universe + ad-hoc contacts.
CREATE TABLE IF NOT EXISTS pa_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  date        TEXT,
  location    TEXT,
  description TEXT,
  invite_body TEXT,                        -- email template; {{name}} / {{event}} tokens
  status      TEXT DEFAULT 'planning',     -- planning | invites_out | done
  created_at  TEXT DEFAULT (datetime('now'))
);

-- Ad-hoc contacts not already in the tool (civil servants, journalists, etc).
CREATE TABLE IF NOT EXISTS contacts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  email       TEXT,
  org         TEXT,
  role        TEXT,
  notes       TEXT,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- An invitee on an event. Either references an MP (mp_id) or a contact
-- (contact_id); name/email are snapshotted so the list is self-contained.
CREATE TABLE IF NOT EXISTS event_invitees (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id   INTEGER NOT NULL,
  mp_id      INTEGER,
  contact_id INTEGER,
  name       TEXT,
  email      TEXT,
  org        TEXT,
  status     TEXT DEFAULT 'shortlist',     -- shortlist | invited | accepted | declined | attended
  notes      TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(event_id, mp_id),
  UNIQUE(event_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_invitee_event ON event_invitees(event_id, status);
