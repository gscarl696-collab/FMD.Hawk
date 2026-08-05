import { query, queryOne, run } from './db.js';
import { requireStaff } from './auth.js';
import { getPlayers } from './players.js';

/* =========================================================================
 * These parameter lists — and their exact wording — must stay byte-for-
 * byte identical to EVAL_TECHNICAL_PARAMS etc. in the frontend's own JS
 * (and the old GS.txt they were copied from). The frontend keys its
 * `scores` object by strings like "Tech: First touch" — getting any of
 * these wrong silently corrupts which rating shows under which label.
 * ========================================================================= */

const EVAL_TECHNICAL_PARAMS = [
  'Ability to play with both feet', 'First touch', 'Short pass', 'Long pass',
  'Attacking 1 v 1', 'Defending 1 v 1', 'Shooting (outside of penalty box)',
  'Finishing (inside of penalty box)', 'Defending header (clearance)', 'Attacking header (to score goal)'
];
const EVAL_TACTICAL_PARAMS = [
  'Game knowledge & understanding', 'Game application', 'Creativity',
  'Individual tactics (1 player)', 'Group tactics (2-5 players)', 'Team tactics (6++ players)'
];
const EVAL_SIX_MOMENT_PARAMS = [
  'Attacking organisation', 'Defending organisation', 'Attacking transition',
  'Defending transition', 'Standard situation', 'Individualism'
];
const EVAL_PHYSICAL_PARAMS = [
  'Strength', 'Speed', 'Endurance', 'Suppleness (flexibility)', 'Body contact', 'Coordination', 'Balance'
];
const EVAL_PSYCHOLOGICAL_PARAMS = [
  'Excitement / enjoyment', 'Concentration', 'Attention seeking', 'Confidence',
  'Communication', 'Relationship with teammates', 'Team spirit'
];

// DB column names, in the exact same order as schema.sql's evaluations table.
const TECH_COLS = ['tech_both_feet', 'tech_first_touch', 'tech_short_pass', 'tech_long_pass', 'tech_attacking_1v1',
  'tech_defending_1v1', 'tech_shooting_outside_box', 'tech_finishing_inside_box', 'tech_defending_header', 'tech_attacking_header'];
const TACT_COLS = ['tact_game_knowledge', 'tact_game_application', 'tact_creativity', 'tact_individual_tactics', 'tact_group_tactics', 'tact_team_tactics'];
const MOMENT_COLS = ['moment_attacking_org', 'moment_defending_org', 'moment_attacking_transition', 'moment_defending_transition', 'moment_standard_situation', 'moment_individualism'];
const PHYS_COLS = ['phys_strength', 'phys_speed', 'phys_endurance', 'phys_suppleness', 'phys_body_contact', 'phys_coordination', 'phys_balance'];
const PSYCH_COLS = ['psych_excitement', 'psych_concentration', 'psych_attention_seeking', 'psych_confidence', 'psych_communication', 'psych_relationship_teammates', 'psych_team_spirit'];

/** Builds the ordered [{ header, column }] map once — "Tech: Ability to
 *  play with both feet" <-> tech_both_feet, etc. — for the exact 35
 *  parameters, in the exact order the frontend expects them grouped. */
const SCORE_MAP = [
  ...EVAL_TECHNICAL_PARAMS.map((p, i) => ({ header: 'Tech: ' + p, column: TECH_COLS[i] })),
  ...EVAL_TACTICAL_PARAMS.map((p, i) => ({ header: 'Tact: ' + p, column: TACT_COLS[i] })),
  ...EVAL_SIX_MOMENT_PARAMS.map((p, i) => ({ header: '6Moment: ' + p, column: MOMENT_COLS[i] })),
  ...EVAL_PHYSICAL_PARAMS.map((p, i) => ({ header: 'Phys: ' + p, column: PHYS_COLS[i] })),
  ...EVAL_PSYCHOLOGICAL_PARAMS.map((p, i) => ({ header: 'Psych: ' + p, column: PSYCH_COLS[i] }))
];

function rowToScores(row) {
  const scores = {};
  SCORE_MAP.forEach(({ header, column }) => { scores[header] = row[column] ?? ''; });
  return scores;
}

/* =========================================================================
 * ATTENDANCE
 * ========================================================================= */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Marks one player present for the given date. Requires a valid Admin or
 *  Coach token. Skips creating a duplicate row if already marked present
 *  for that date, reporting `duplicate: true` instead. */
export async function recordAttendance(token, date, playerId) {
  const info = await requireStaff(token);
  date = String(date || '').trim();
  playerId = String(playerId || '').trim();
  if (!date) throw new Error('Please choose a session date first.');
  if (!DATE_RE.test(date)) throw new Error('Invalid date format.');
  if (!playerId) throw new Error('No Player ID was found in that QR code.');

  const player = await queryOne('SELECT player_id, name, category, position FROM players WHERE player_id = ?', [playerId]);
  if (!player) throw new Error(`QR code not recognized — Player ID "${playerId}" was not found.`);

  const existing = await queryOne('SELECT id FROM attendance WHERE date = ? AND player_id = ?', [date, playerId]);
  if (existing) return { success: true, duplicate: true, playerName: player.name, category: player.category };

  const scannedByName = info.name || info.accountId || 'Unknown';
  await run('INSERT INTO attendance (date, player_id, player_name, category, time_scanned, scanned_by) VALUES (?, ?, ?, ?, ?, ?)',
    [date, playerId, player.name, player.category, new Date().toISOString(), scannedByName]);

  // A player being marked present is the ONLY thing that creates an
  // Evaluation Form — never done manually.
  await createEvaluationIfMissing(date, player);

  return { success: true, duplicate: false, playerName: player.name, category: player.category };
}

/** Formats a stored ISO timestamp into the same "10:16 AM"-style display
 *  the old backend produced (Utilities.formatDate(..., 'h:mm a')), in the
 *  club's own timezone rather than UTC. */
function formatScanTime(isoString) {
  if (!isoString) return '';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kuala_Lumpur', hour: 'numeric', minute: '2-digit', hour12: true
    }).format(new Date(isoString));
  } catch (err) {
    return isoString; // fall back to the raw value rather than showing nothing
  }
}

export async function getAttendanceForDate(token, date) {
  await requireStaff(token);
  date = String(date || '').trim();
  if (!date) return [];
  const rows = await query('SELECT * FROM attendance WHERE date = ?', [date]);
  return rows
    .sort((a, b) => String(a.time_scanned).localeCompare(String(b.time_scanned))) // sort by raw ISO first — sorting the formatted "10:16 AM" strings would put 10 AM before 9 AM
    .map((r) => ({
      playerId: r.player_id, playerName: r.player_name, category: r.category,
      timeScanned: formatScanTime(r.time_scanned), scannedBy: r.scanned_by
    }));
}

/** Every distinct date with at least one attendance record, newest first. */
export async function getAttendanceSessionDates(token) {
  await requireStaff(token);
  const rows = await query('SELECT DISTINCT date FROM attendance ORDER BY date DESC');
  return rows.map((r) => r.date);
}

/* =========================================================================
 * PLAYER EVALUATION — auto-created (Status: Pending) the moment a player
 * is scanned present in Attendance for a given date. Never created any
 * other way.
 * ========================================================================= */

/** Best-effort — called right after a successful attendance scan. Never
 *  throws; a hiccup here should never block attendance itself. */
async function createEvaluationIfMissing(date, player) {
  try {
    const existing = await queryOne('SELECT evaluation_id FROM evaluations WHERE date = ? AND player_id = ?', [date, player.player_id]);
    if (existing) return false;

    const evalId = 'EVAL-' + player.player_id + '-' + date;
    await run(
      `INSERT INTO evaluations (evaluation_id, date, player_id, player_name, category, position, status)
       VALUES (?, ?, ?, ?, ?, ?, 'Pending')`,
      [evalId, date, player.player_id, player.name, player.category, player.position || '']
    );
    return true;
  } catch (err) {
    return false;
  }
}

/** Summary list for one session date — name/category/status only, for the
 *  Player Evaluation tab's table. */
export async function getEvaluationsForDate(token, date) {
  await requireStaff(token);
  date = String(date || '').trim();
  if (!date) return [];
  const rows = await query('SELECT evaluation_id, date, player_id, player_name, category, position, status FROM evaluations WHERE date = ?', [date]);
  return rows.map((r) => ({
    evaluationId: r.evaluation_id, date: r.date, playerId: r.player_id, playerName: r.player_name,
    category: r.category, position: r.position, status: r.status || 'Pending'
  }));
}

/** The full form for one evaluation — every rating, plus whatever's
 *  already been filled in (blank/"Pending" the first time it's opened). */
export async function getEvaluationDetail(token, evaluationId) {
  await requireStaff(token);
  const row = await queryOne('SELECT * FROM evaluations WHERE evaluation_id = ?', [String(evaluationId || '').trim()]);
  if (!row) throw new Error('Evaluation not found.');
  return {
    evaluationId: row.evaluation_id, date: row.date, playerId: row.player_id, playerName: row.player_name,
    category: row.category, position: row.position, status: row.status || 'Pending',
    scores: rowToScores(row),
    comment: row.additional_comment || '', completedBy: row.completed_by || '',
    completedDate: row.completed_date || '', decision: row.decision || ''
  };
}

/** Saves a filled-in (or edited) evaluation form. Marks it Completed. */
export async function saveEvaluation(token, evaluationId, formData) {
  const info = await requireStaff(token);
  evaluationId = String(evaluationId || '').trim();
  formData = formData || {};

  const existing = await queryOne('SELECT evaluation_id FROM evaluations WHERE evaluation_id = ?', [evaluationId]);
  if (!existing) throw new Error('Evaluation not found.');

  const sets = [], args = [];
  SCORE_MAP.forEach(({ header, column }) => {
    sets.push(column + ' = ?');
    args.push((formData.scores && formData.scores[header] !== undefined) ? formData.scores[header] : null);
  });

  const completedDate = formData.completedDate || new Date().toISOString().slice(0, 10);
  sets.push('additional_comment = ?', 'completed_by = ?', 'completed_date = ?', 'decision = ?', 'completed_by_role = ?', 'status = ?');
  args.push(
    formData.comment || '',
    formData.completedBy || info.name || info.accountId || 'Unknown',
    completedDate,
    formData.decision || '',
    info.accountType === 'coach' ? 'Coach' : 'Admin',
    'Completed'
  );

  args.push(evaluationId);
  await run(`UPDATE evaluations SET ${sets.join(', ')} WHERE evaluation_id = ?`, args);
  return { success: true };
}

/* =========================================================================
 * PLAYER PERFORMANCE — a date-based view of completed evaluations.
 * ========================================================================= */

function rowToPerformance(row) {
  return {
    evaluationId: row.evaluation_id, date: row.date, playerId: row.player_id, playerName: row.player_name,
    category: row.category, position: row.position || '', scores: rowToScores(row),
    comment: row.additional_comment || '', completedBy: row.completed_by || '',
    completedDate: row.completed_date || '', decision: row.decision || ''
  };
}

export async function getPlayerPerformanceForDate(token, date) {
  await requireStaff(token);
  date = String(date || '').trim();
  if (!date) return [];
  const rows = await query("SELECT * FROM evaluations WHERE date = ? AND status = 'Completed'", [date]);
  return rows.map(rowToPerformance);
}

function normalizeMyKidForLookup(value) {
  return String(value || '').trim().replace(/[\s-]/g, '').toUpperCase();
}

/** Public report lookup — a parent provides the exact session date and
 *  the player's MyKid number. Nothing is returned unless that player has
 *  a completed evaluation for that specific session. */
export async function getPublicPlayerPerformance(date, myKid) {
  date = String(date || '').trim();
  const lookupMyKid = normalizeMyKidForLookup(myKid);
  if (!date || !lookupMyKid) return null;

  const players = await query("SELECT player_id, my_kid FROM players WHERE status != 'Pending'");
  const player = players.find((p) => normalizeMyKidForLookup(p.my_kid) === lookupMyKid);
  if (!player) return null;

  const row = await queryOne(
    "SELECT * FROM evaluations WHERE date = ? AND player_id = ? AND status = 'Completed'",
    [date, player.player_id]
  );
  if (!row) return null;
  return rowToPerformance(row);
}
