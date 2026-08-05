-- =========================================================================
-- THE HAWK Elite Football Club — Turso (libSQL/SQLite) schema
-- Mirrors the current Google Sheets structure 1:1, field-for-field, to
-- keep this migration low-risk. Normalizing (e.g. splitting Evaluations'
-- 35 flat rating columns into a proper child table) is left as a
-- deliberate follow-up, not bundled into this migration.
-- =========================================================================

-- ---------------------------------------------------------------------
-- PLAYERS  (was: 'Form Responses 1')
-- ---------------------------------------------------------------------
CREATE TABLE players (
  player_id       TEXT PRIMARY KEY,
  timestamp       TEXT,
  name            TEXT NOT NULL,
  my_kid          TEXT,
  age             INTEGER,
  school          TEXT,
  guardian_name   TEXT,
  guardian_phone  TEXT,
  address         TEXT,
  image_raw       TEXT,   -- original Drive upload link(s) from the form
  birth_cert_raw  TEXT,   -- admin-only, never exposed publicly
  mykid_copy_raw  TEXT,   -- admin-only, never exposed publicly
  category        TEXT,   -- U6..U12
  status          TEXT,   -- Pending / Active / Inactive / Suspended
  notes           TEXT,
  image_url       TEXT,   -- public-ready thumbnail derived from image_raw
  player_number   INTEGER,
  position        TEXT,
  active_since    TEXT,   -- date status last changed TO "Active"
  qr_code_url     TEXT
);

-- ---------------------------------------------------------------------
-- COACHES  (public "Meet the Coaches" roster — NOT login accounts)
-- ---------------------------------------------------------------------
CREATE TABLE coaches (
  coach_id      TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  title         TEXT,
  image_url     TEXT,
  sort_order    INTEGER,
  status        TEXT,
  active_since  TEXT,
  bio           TEXT,
  license       TEXT,
  my_kad        TEXT,
  age           INTEGER,
  phone         TEXT,
  address       TEXT,
  email         TEXT
);

-- ---------------------------------------------------------------------
-- MANAGEMENT  (public "Meet the Management Team" roster)
-- ---------------------------------------------------------------------
CREATE TABLE management (
  member_id     TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  title         TEXT,
  image_url     TEXT,
  sort_order    INTEGER,
  status        TEXT,
  active_since  TEXT,
  bio           TEXT
);

-- ---------------------------------------------------------------------
-- CLUB REGISTRATION  (was: 'SSM' — single settings row, not a list)
-- ---------------------------------------------------------------------
CREATE TABLE club_registration (
  id             INTEGER PRIMARY KEY CHECK (id = 1),  -- enforces single row
  ssm_number     TEXT,
  document_url   TEXT
);

-- ---------------------------------------------------------------------
-- ACHIEVEMENTS  (Hall of Fame — text only)
-- ---------------------------------------------------------------------
CREATE TABLE achievements (
  achievement_id  TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  details         TEXT,
  year            INTEGER
);

-- ---------------------------------------------------------------------
-- GALLERY
-- ---------------------------------------------------------------------
CREATE TABLE gallery (
  photo_id   TEXT PRIMARY KEY,
  image_url  TEXT NOT NULL,
  caption    TEXT,
  year       INTEGER,
  date       TEXT
);

-- ---------------------------------------------------------------------
-- TEAM  (public "Meet the Team" grid)
-- ---------------------------------------------------------------------
CREATE TABLE team (
  member_id   TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  title       TEXT,
  image_url   TEXT,
  sort_order  INTEGER
);

-- ---------------------------------------------------------------------
-- NOTIFICATIONS  (Admin/Coach inbox)
-- ---------------------------------------------------------------------
CREATE TABLE notifications (
  notification_id  TEXT PRIMARY KEY,
  type             TEXT,
  message          TEXT,
  player_id        TEXT,
  timestamp        TEXT,
  read             INTEGER DEFAULT 0   -- 0/1 boolean
);

-- ---------------------------------------------------------------------
-- TRAINING
-- ---------------------------------------------------------------------
CREATE TABLE training (
  training_id    TEXT PRIMARY KEY,
  category       TEXT,
  training_name  TEXT,
  date           TEXT,
  start_time     TEXT,
  end_time       TEXT,
  location       TEXT,
  coach          TEXT,
  status         TEXT,
  notes          TEXT,
  full_details   TEXT
);

-- ---------------------------------------------------------------------
-- TRAINING PRESETS  (quick-select dropdown options, admin-editable)
-- ---------------------------------------------------------------------
CREATE TABLE training_presets (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  field  TEXT NOT NULL,   -- which dropdown this belongs to
  value  TEXT NOT NULL
);

-- ---------------------------------------------------------------------
-- DASHBOARD LOGS  (login/logout audit trail — never read by frontend)
-- ---------------------------------------------------------------------
CREATE TABLE dashboard_logs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT,
  role         TEXT,
  date         TEXT,
  login_time   TEXT,
  logout_time  TEXT
);

-- ---------------------------------------------------------------------
-- ATTENDANCE  (one row per player per session date)
-- ---------------------------------------------------------------------
CREATE TABLE attendance (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  date          TEXT NOT NULL,
  player_id     TEXT NOT NULL,
  player_name   TEXT,
  category      TEXT,
  time_scanned  TEXT,
  scanned_by    TEXT
);

-- ---------------------------------------------------------------------
-- EVALUATIONS  (one row per player per session — 35 rating columns kept
-- flat exactly as in the current sheet, to minimize migration risk)
-- ---------------------------------------------------------------------
CREATE TABLE evaluations (
  evaluation_id  TEXT PRIMARY KEY,
  date           TEXT,
  player_id      TEXT,
  player_name    TEXT,
  category       TEXT,
  position       TEXT,
  status         TEXT,

  -- Technical (10)
  tech_both_feet INTEGER, tech_first_touch INTEGER, tech_short_pass INTEGER,
  tech_long_pass INTEGER, tech_attacking_1v1 INTEGER, tech_defending_1v1 INTEGER,
  tech_shooting_outside_box INTEGER, tech_finishing_inside_box INTEGER,
  tech_defending_header INTEGER, tech_attacking_header INTEGER,

  -- Tactical (6)
  tact_game_knowledge INTEGER, tact_game_application INTEGER, tact_creativity INTEGER,
  tact_individual_tactics INTEGER, tact_group_tactics INTEGER, tact_team_tactics INTEGER,

  -- The 6 Moments (6)
  moment_attacking_org INTEGER, moment_defending_org INTEGER, moment_attacking_transition INTEGER,
  moment_defending_transition INTEGER, moment_standard_situation INTEGER, moment_individualism INTEGER,

  -- Physical (7)
  phys_strength INTEGER, phys_speed INTEGER, phys_endurance INTEGER, phys_suppleness INTEGER,
  phys_body_contact INTEGER, phys_coordination INTEGER, phys_balance INTEGER,

  -- Psychological (7)
  psych_excitement INTEGER, psych_concentration INTEGER, psych_attention_seeking INTEGER,
  psych_confidence INTEGER, psych_communication INTEGER, psych_relationship_teammates INTEGER,
  psych_team_spirit INTEGER,

  additional_comment  TEXT,
  completed_by        TEXT,
  completed_date       TEXT,
  decision             TEXT,   -- Retain / Further Review / Release
  completed_by_role    TEXT
);

-- ---------------------------------------------------------------------
-- TOURNAMENTS
-- categories kept as a comma-separated TEXT field (e.g. "U6,U7,U8") to
-- exactly match current behavior — normalizing into a join table is a
-- reasonable future improvement, not part of this migration.
-- ---------------------------------------------------------------------
CREATE TABLE tournaments (
  tournament_id  TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  categories     TEXT,
  date           TEXT,
  start_time     TEXT,
  end_time       TEXT,
  location       TEXT,
  status         TEXT,
  notes          TEXT,
  full_details   TEXT
);

-- ---------------------------------------------------------------------
-- ADMINS  (Admin Dashboard login accounts)
-- ---------------------------------------------------------------------
CREATE TABLE admins (
  admin_id        TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  email           TEXT,
  role            TEXT,
  status          TEXT,
  password        TEXT NOT NULL,   -- hashed, never plaintext
  password_salt   TEXT NOT NULL
);

-- ---------------------------------------------------------------------
-- COACH ACCOUNTS  (Coach Dashboard login accounts — separate from the
-- public "Coaches" roster above, on purpose, so a coach session can
-- never reach admin-only features)
-- ---------------------------------------------------------------------
CREATE TABLE coach_accounts (
  coach_id       TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  email          TEXT,
  status         TEXT,
  password       TEXT NOT NULL,
  password_salt  TEXT NOT NULL
);

-- ---------------------------------------------------------------------
-- Helpful indexes for the lookups the app actually does most often
-- ---------------------------------------------------------------------
CREATE INDEX idx_attendance_date ON attendance(date);
CREATE INDEX idx_attendance_player ON attendance(player_id);
CREATE INDEX idx_evaluations_date ON evaluations(date);
CREATE INDEX idx_evaluations_player ON evaluations(player_id);
CREATE INDEX idx_notifications_read ON notifications(read);
CREATE INDEX idx_players_status ON players(status);
CREATE INDEX idx_players_category ON players(category);

-- =========================================================================
-- AUTH / SESSION INFRASTRUCTURE
-- Replaces Apps Script's CacheService (sessions, rate limiting, brute-force
-- lockout all lived there with automatic TTL expiry). Turso has no
-- equivalent built-in cache, so these are just regular tables with an
-- expires_at column — checked on read, no active cleanup needed at this
-- scale (a cron to purge old rows can be added later if it's ever worth it).
-- =========================================================================

-- Active login sessions (was: CacheService key "admin_token_"/"coach_token_")
CREATE TABLE sessions (
  token         TEXT PRIMARY KEY,
  account_type  TEXT NOT NULL,   -- 'admin' or 'coach'
  account_id    TEXT NOT NULL,   -- admin_id or coach_id
  name          TEXT,
  role          TEXT,            -- admin only
  expires_at    INTEGER NOT NULL -- unix timestamp (seconds)
);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- Brute-force login lockout (was: CacheService key "login_attempts_")
CREATE TABLE login_attempts (
  login_id      TEXT PRIMARY KEY,  -- lowercased/trimmed admin or coach ID
  attempt_count INTEGER NOT NULL DEFAULT 0,
  locked_until  INTEGER            -- unix timestamp; NULL if not locked
);

-- Per-token API rate limiting (was: CacheService key "rate_")
CREATE TABLE rate_limits (
  token          TEXT PRIMARY KEY,
  request_count  INTEGER NOT NULL DEFAULT 0,
  window_start   INTEGER NOT NULL  -- unix timestamp the current 60s window began
);

-- Tracks which Google Sheet form rows have already been synced into
-- players, so the sync job never double-inserts the same registration.
CREATE TABLE synced_form_rows (
  player_id    TEXT PRIMARY KEY,  -- matches players.player_id once synced
  sheet_row    INTEGER NOT NULL,  -- row number in "Form Responses 1", for debugging
  synced_at    INTEGER NOT NULL
);
