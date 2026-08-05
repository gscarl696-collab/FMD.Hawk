import crypto from 'node:crypto';
import { query, queryOne, run } from './db.js';

/* =========================================================================
 * PASSWORD HASHING — identical scheme to the old Apps Script backend:
 * SHA-256(password + salt), hex-encoded, random per-account salt. Kept
 * unchanged on purpose so migrated password hashes stay valid — no forced
 * password reset for existing admins/coaches.
 * ========================================================================= */

export function generateSalt() {
  return crypto.randomUUID().replace(/-/g, '');
}

export function hashPasswordWithSalt(password, salt) {
  return crypto.createHash('sha256').update(String(password) + String(salt)).digest('hex');
}

/** Verifies a password against a stored hash+salt. A blank salt means a
 *  legacy plaintext row (carried over from before hashing existed) — falls
 *  back to a direct comparison so nothing already migrated gets locked
 *  out, and flags upgradeNeeded so the caller can rewrite it as a proper
 *  hash right after this successful login. */
export function verifyPassword(inputPassword, storedPassword, storedSalt) {
  if (!storedPassword) return { valid: false, upgradeNeeded: false };
  if (!storedSalt) {
    const valid = String(inputPassword) === String(storedPassword);
    return { valid, upgradeNeeded: valid };
  }
  const computed = hashPasswordWithSalt(inputPassword, storedSalt);
  return { valid: computed === storedPassword, upgradeNeeded: false };
}

/* =========================================================================
 * BRUTE-FORCE LOCKOUT — 5 failed attempts locks that login ID out for 5
 * minutes. Keyed by login ID (not IP — same tradeoff the old backend made).
 * ========================================================================= */

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCKOUT_SECONDS = 300;

function loginAttemptsKey(loginId) {
  return String(loginId || '').trim().toLowerCase();
}

export async function assertNotLockedOut(loginId) {
  const key = loginAttemptsKey(loginId);
  const row = await queryOne('SELECT locked_until FROM login_attempts WHERE login_id = ?', [key]);
  if (!row || !row.locked_until) return;
  const now = Math.floor(Date.now() / 1000);
  if (row.locked_until > now) {
    throw new Error('Too many failed login attempts. Please try again in a few minutes.');
  }
}

export async function recordFailedLogin(loginId) {
  const key = loginAttemptsKey(loginId);
  const now = Math.floor(Date.now() / 1000);
  const row = await queryOne('SELECT attempt_count FROM login_attempts WHERE login_id = ?', [key]);
  const count = (row ? row.attempt_count : 0) + 1;
  const lockedUntil = count >= MAX_LOGIN_ATTEMPTS ? now + LOGIN_LOCKOUT_SECONDS : null;
  await run(
    `INSERT INTO login_attempts (login_id, attempt_count, locked_until) VALUES (?, ?, ?)
     ON CONFLICT(login_id) DO UPDATE SET attempt_count = excluded.attempt_count, locked_until = excluded.locked_until`,
    [key, count, lockedUntil]
  );
}

export async function clearFailedLogins(loginId) {
  await run('DELETE FROM login_attempts WHERE login_id = ?', [loginAttemptsKey(loginId)]);
}

/* =========================================================================
 * SESSIONS — replaces CacheService's 6-hour token cache with a real table.
 * ========================================================================= */

const SESSION_TTL_SECONDS = 60 * 60 * 6; // 6 hours, same as before

export async function createSession(accountType, accountId, name, role) {
  const token = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  await run(
    'INSERT INTO sessions (token, account_type, account_id, name, role, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    [token, accountType, accountId, name || '', role || '', expiresAt]
  );
  return token;
}

/** Looks up a session by token. Returns null if missing or expired —
 *  callers throw their own "please log in again" message so the wording
 *  stays consistent with the rest of the API. */
async function getSession(token) {
  if (!token) return null;
  const now = Math.floor(Date.now() / 1000);
  const row = await queryOne('SELECT * FROM sessions WHERE token = ? AND expires_at > ?', [token, now]);
  return row;
}

/** Accepts EITHER a valid admin or coach token — for functionality both
 *  dashboards share (Players, Training, Tournaments). Throws if neither. */
export async function requireStaff(token) {
  const session = await getSession(token);
  if (!session) throw new Error('Session expired. Please log in again.');
  return { accountType: session.account_type, accountId: session.account_id, name: session.name, role: session.role };
}

/** Admin-only — everything Achievements/Gallery/Team/Coaches roster/
 *  Management/Club Registration/Notifications/Manage Admins related.
 *  A coach token is never accepted here, no matter what the frontend sends. */
export async function requireAdmin(token) {
  const session = await getSession(token);
  if (!session || session.account_type !== 'admin') throw new Error('Session expired. Please log in again.');
  return { accountId: session.account_id, name: session.name, role: session.role };
}

export async function requireCoach(token) {
  const session = await getSession(token);
  if (!session || session.account_type !== 'coach') throw new Error('Session expired. Please log in again.');
  return { accountId: session.account_id, name: session.name };
}

/** Non-throwing checks — for endpoints that behave differently for staff
 *  vs the public rather than rejecting the public outright. */
export async function isAdminToken(token) {
  const session = await getSession(token);
  return !!session && session.account_type === 'admin';
}

export async function isStaffToken(token) {
  const session = await getSession(token);
  return !!session;
}

/* =========================================================================
 * RATE LIMITING — caps a single session token at 90 requests/minute.
 * Sliding-window-ish via a stored window-start timestamp, reset once 60s
 * have passed since that window began.
 * ========================================================================= */

const RATE_LIMIT_MAX_PER_MINUTE = 90;
const RATE_LIMIT_WINDOW_SECONDS = 60;

export async function checkRateLimit(token) {
  if (!token) return; // public reads have no token to key on, same as before
  const now = Math.floor(Date.now() / 1000);
  const row = await queryOne('SELECT request_count, window_start FROM rate_limits WHERE token = ?', [token]);

  if (!row || now - row.window_start >= RATE_LIMIT_WINDOW_SECONDS) {
    // Fresh window.
    await run(
      `INSERT INTO rate_limits (token, request_count, window_start) VALUES (?, 1, ?)
       ON CONFLICT(token) DO UPDATE SET request_count = 1, window_start = excluded.window_start`,
      [token, now]
    );
    return;
  }

  if (row.request_count >= RATE_LIMIT_MAX_PER_MINUTE) {
    throw new Error('Too many requests — please slow down and try again in a moment.');
  }
  await run('UPDATE rate_limits SET request_count = request_count + 1 WHERE token = ?', [token]);
}
