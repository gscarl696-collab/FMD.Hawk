import { query, queryOne, run } from './db.js';
import {
  verifyPassword, hashPasswordWithSalt, generateSalt,
  assertNotLockedOut, recordFailedLogin, clearFailedLogins,
  createSession, requireAdmin, requireCoach
} from './auth.js';

/* =========================================================================
 * DASHBOARD LOGIN/LOGOUT AUDIT LOG — best-effort, never blocks login/logout
 * on a logging failure, exactly like the old backend.
 * ========================================================================= */

async function logDashboardLogin(name, role) {
  try {
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    await run('INSERT INTO dashboard_logs (name, role, date, login_time, logout_time) VALUES (?, ?, ?, ?, ?)',
      [name, role, dateStr, now.toISOString(), null]);
  } catch (err) { /* best-effort only */ }
}

async function logDashboardLogout(name, role) {
  try {
    const todayStr = new Date().toISOString().slice(0, 10);
    // Most recent still-open row for this person today (blank logout_time).
    const row = await queryOne(
      `SELECT id FROM dashboard_logs WHERE name = ? AND role = ? AND date = ? AND logout_time IS NULL
       ORDER BY id DESC LIMIT 1`,
      [name, role, todayStr]
    );
    if (row) await run('UPDATE dashboard_logs SET logout_time = ? WHERE id = ?', [new Date().toISOString(), row.id]);
  } catch (err) { /* best-effort only */ }
}

/* =========================================================================
 * ADMIN LOGIN
 * ========================================================================= */

export async function adminLogin(adminId, password) {
  await assertNotLockedOut(adminId);
  const row = await queryOne('SELECT * FROM admins WHERE admin_id = ?', [adminId]);
  if (!row) { await recordFailedLogin(adminId); return { success: false, message: 'Incorrect Admin ID or password.' }; }

  const check = verifyPassword(password, row.password, row.password_salt);
  if (!check.valid) { await recordFailedLogin(adminId); return { success: false, message: 'Incorrect Admin ID or password.' }; }
  await clearFailedLogins(adminId);

  if (check.upgradeNeeded) {
    const salt = generateSalt();
    await run('UPDATE admins SET password = ?, password_salt = ? WHERE admin_id = ?',
      [hashPasswordWithSalt(password, salt), salt, adminId]);
  }
  if (row.status !== 'Active') {
    return { success: false, message: `This admin account is "${row.status}" and cannot log in until an active admin sets its status to Active.` };
  }

  const token = await createSession('admin', adminId, row.name, row.role);
  return { success: true, token, adminId, name: row.name, role: row.role };
}

/* =========================================================================
 * COACH LOGIN
 * ========================================================================= */

export async function coachLogin(coachId, password) {
  await assertNotLockedOut(coachId);
  const row = await queryOne('SELECT * FROM coach_accounts WHERE coach_id = ?', [coachId]);
  if (!row) { await recordFailedLogin(coachId); return { success: false, message: 'Incorrect Coach ID or password.' }; }

  const check = verifyPassword(password, row.password, row.password_salt);
  if (!check.valid) { await recordFailedLogin(coachId); return { success: false, message: 'Incorrect Coach ID or password.' }; }
  await clearFailedLogins(coachId);

  if (check.upgradeNeeded) {
    const salt = generateSalt();
    await run('UPDATE coach_accounts SET password = ?, password_salt = ? WHERE coach_id = ?',
      [hashPasswordWithSalt(password, salt), salt, coachId]);
  }
  if (row.status !== 'Active') {
    return { success: false, message: `This coach account is "${row.status}" and cannot log in until an admin sets its status to Active.` };
  }

  const token = await createSession('coach', coachId, row.name, null);
  return { success: true, token, coachId, name: row.name };
}

/** Single entry point the login screen calls — tries Admins first, then
 *  CoachAccounts. An ID in neither gets one generic message, same as
 *  before (doesn't leak which table was checked). */
export async function login(loginId, password) {
  await assertNotLockedOut(loginId);

  const admin = await queryOne('SELECT admin_id FROM admins WHERE admin_id = ?', [loginId]);
  if (admin) {
    const result = await adminLogin(loginId, password);
    result.accountType = 'admin';
    if (result.success) await logDashboardLogin(result.name || loginId, 'Admin');
    return result;
  }

  const coach = await queryOne('SELECT coach_id FROM coach_accounts WHERE coach_id = ?', [loginId]);
  if (coach) {
    const result = await coachLogin(loginId, password);
    result.accountType = 'coach';
    if (result.success) await logDashboardLogin(result.name || loginId, 'Coach');
    return result;
  }

  await recordFailedLogin(loginId);
  return { success: false, message: 'ID not found.' };
}

/** Frontend calls this right before clearing its own session. Always
 *  returns success — logout should never be blocked by a logging hiccup. */
export async function recordDashboardLogout(token) {
  try {
    const session = await queryOne('SELECT * FROM sessions WHERE token = ?', [token]);
    if (session) {
      const role = session.account_type === 'coach' ? 'Coach' : 'Admin';
      await logDashboardLogout(session.name || session.account_id, role);
    }
  } catch (err) { /* best-effort */ }
  await run('DELETE FROM sessions WHERE token = ?', [token]).catch(() => {});
  return { success: true };
}

/* =========================================================================
 * ADMIN ACCOUNT MANAGEMENT (all admin-only)
 * ========================================================================= */

export async function createAdmin(token, name, email) {
  await requireAdmin(token);
  if (!name || !email) throw new Error('Name and Email are required.');

  const rows = await query('SELECT admin_id FROM admins');
  let highest = 0;
  rows.forEach((r) => { const m = String(r.admin_id).match(/(\d+)$/); if (m) highest = Math.max(highest, parseInt(m[1], 10)); });
  const newId = 'ADM' + ('000' + (highest + 1)).slice(-3);

  await run('INSERT INTO admins (admin_id, name, email, role, status, password, password_salt) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [newId, name, email, 'Admin', 'Pending', '', '']);
  return { adminId: newId, name, email, role: 'Admin', status: 'Pending' };
}

/** Sets status and/or password (and optionally name/email) on an existing
 *  admin — how a Pending admin gets approved, and how the initial password
 *  gets set right after createAdmin() generates the ID. */
export async function updateAdminByRow(token, adminId, updates) {
  await requireAdmin(token);
  updates = updates || {};
  const existing = await queryOne('SELECT admin_id FROM admins WHERE admin_id = ?', [adminId]);
  if (!existing) throw new Error('Admin not found: ' + adminId);

  const sets = [], args = [];
  if (updates.status !== undefined) { sets.push('status = ?'); args.push(updates.status); }
  if (updates.password !== undefined && updates.password !== '') {
    if (String(updates.password).length < 6) throw new Error('Password must be at least 6 characters.');
    const salt = generateSalt();
    sets.push('password = ?', 'password_salt = ?');
    args.push(hashPasswordWithSalt(updates.password, salt), salt);
  }
  if (updates.name !== undefined) { sets.push('name = ?'); args.push(updates.name); }
  if (updates.email !== undefined) { sets.push('email = ?'); args.push(updates.email); }
  if (!sets.length) return { success: true };
  args.push(adminId);
  await run(`UPDATE admins SET ${sets.join(', ')} WHERE admin_id = ?`, args);
  return { success: true };
}

/** The CURRENTLY LOGGED-IN admin changing their own Admin ID and/or password. */
export async function updateMyAccount(token, updates) {
  const info = await requireAdmin(token);
  updates = updates || {};
  let idChanged = false;

  if (updates.newAdminId && updates.newAdminId !== info.accountId) {
    const clash = await queryOne('SELECT admin_id FROM admins WHERE admin_id = ?', [updates.newAdminId]);
    if (clash) throw new Error('That Admin ID is already taken.');
    await run('UPDATE admins SET admin_id = ? WHERE admin_id = ?', [updates.newAdminId, info.accountId]);
    // Session references the old ID — move it forward so the same token stays valid.
    await run('UPDATE sessions SET account_id = ? WHERE token = ?', [updates.newAdminId, token]);
    idChanged = true;
  }
  if (updates.newPassword) {
    if (String(updates.newPassword).length < 6) throw new Error('Password must be at least 6 characters.');
    const salt = generateSalt();
    const idNow = updates.newAdminId || info.accountId;
    await run('UPDATE admins SET password = ?, password_salt = ? WHERE admin_id = ?',
      [hashPasswordWithSalt(updates.newPassword, salt), salt, idNow]);
  }

  if (idChanged) {
    // Old backend force-expired the token here since the ID it was keyed
    // to no longer existed; this version just moved the session forward
    // instead, so re-login isn't strictly required — but the frontend
    // still expects this flag, so keep reporting it for a consistent UX
    // (a fresh login after changing your own ID is reasonable either way).
    return { success: true, requiresRelogin: true };
  }
  return { success: true, requiresRelogin: false };
}

export async function getAdmins(token) {
  await requireAdmin(token);
  const rows = await query('SELECT admin_id, name, email, role, status FROM admins');
  return rows.map((r) => ({ adminId: r.admin_id, name: r.name, email: r.email, role: r.role, status: r.status || 'Pending' }));
}

/* =========================================================================
 * COACH ACCOUNT MANAGEMENT (all admin-only, except updateMyCoachAccount)
 * ========================================================================= */

export async function createCoachAccount(token, name, email) {
  await requireAdmin(token);
  if (!name || !email) throw new Error('Name and Email are required.');

  const rows = await query('SELECT coach_id FROM coach_accounts');
  let highest = 0;
  rows.forEach((r) => { const m = String(r.coach_id).match(/(\d+)$/); if (m) highest = Math.max(highest, parseInt(m[1], 10)); });
  const newId = 'COACH' + ('000' + (highest + 1)).slice(-3);

  await run('INSERT INTO coach_accounts (coach_id, name, email, status, password, password_salt) VALUES (?, ?, ?, ?, ?, ?)',
    [newId, name, email, 'Pending', '', '']);
  return { coachId: newId, name, email, status: 'Pending' };
}

export async function updateCoachAccountByRow(token, coachId, updates) {
  await requireAdmin(token);
  updates = updates || {};
  const existing = await queryOne('SELECT coach_id FROM coach_accounts WHERE coach_id = ?', [coachId]);
  if (!existing) throw new Error('Coach not found: ' + coachId);

  const sets = [], args = [];
  if (updates.status !== undefined) { sets.push('status = ?'); args.push(updates.status); }
  if (updates.password !== undefined && updates.password !== '') {
    if (String(updates.password).length < 6) throw new Error('Password must be at least 6 characters.');
    const salt = generateSalt();
    sets.push('password = ?', 'password_salt = ?');
    args.push(hashPasswordWithSalt(updates.password, salt), salt);
  }
  if (updates.name !== undefined) { sets.push('name = ?'); args.push(updates.name); }
  if (updates.email !== undefined) { sets.push('email = ?'); args.push(updates.email); }
  if (!sets.length) return { success: true };
  args.push(coachId);
  await run(`UPDATE coach_accounts SET ${sets.join(', ')} WHERE coach_id = ?`, args);
  return { success: true };
}

export async function getCoachAccountsList(token) {
  await requireAdmin(token);
  const rows = await query('SELECT coach_id, name, email, status FROM coach_accounts');
  return rows.map((r) => ({ coachId: r.coach_id, name: r.name, email: r.email, role: 'Coach', status: r.status || 'Pending' }));
}

/** The CURRENTLY LOGGED-IN coach changing their own Coach ID and/or password. */
export async function updateMyCoachAccount(token, updates) {
  const info = await requireCoach(token);
  updates = updates || {};
  let idChanged = false;

  if (updates.newCoachId && updates.newCoachId !== info.accountId) {
    const clash = await queryOne('SELECT coach_id FROM coach_accounts WHERE coach_id = ?', [updates.newCoachId]);
    if (clash) throw new Error('That Coach ID is already taken.');
    await run('UPDATE coach_accounts SET coach_id = ? WHERE coach_id = ?', [updates.newCoachId, info.accountId]);
    await run('UPDATE sessions SET account_id = ? WHERE token = ?', [updates.newCoachId, token]);
    idChanged = true;
  }
  if (updates.newPassword) {
    if (String(updates.newPassword).length < 6) throw new Error('Password must be at least 6 characters.');
    const salt = generateSalt();
    const idNow = updates.newCoachId || info.accountId;
    await run('UPDATE coach_accounts SET password = ?, password_salt = ? WHERE coach_id = ?',
      [hashPasswordWithSalt(updates.newPassword, salt), salt, idNow]);
  }

  return { success: true, requiresRelogin: idChanged };
}
