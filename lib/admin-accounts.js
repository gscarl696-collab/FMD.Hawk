import { query, queryOne, run } from './db.js';
import {
  verifyPassword, hashPassword,
  assertNotLockedOut, recordFailedLogin, clearFailedLogins, checkLoginIpRateLimit,
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

/** Re-hashes a password with bcrypt right after a successful legacy-format
 *  login (SHA-256+salt, or old plaintext) — the upgrade happens silently,
 *  the person never notices, but their account is now on the modern
 *  hashing scheme. password_salt is cleared since bcrypt doesn't need a
 *  separate salt column — it's embedded in the hash itself. */
async function upgradeToBcrypt(table, idColumn, id, plaintextPassword) {
  const newHash = await hashPassword(plaintextPassword);
  await run(`UPDATE ${table} SET password = ?, password_salt = '' WHERE ${idColumn} = ?`, [newHash, id]);
}

/* =========================================================================
 * ADMIN LOGIN
 * ========================================================================= */

export async function adminLogin(adminId, password, ip) {
  await checkLoginIpRateLimit(ip);
  await assertNotLockedOut(adminId);
  const row = await queryOne('SELECT * FROM admins WHERE admin_id = ?', [adminId]);
  if (!row) { await recordFailedLogin(adminId); return { success: false, message: 'Incorrect Admin ID or password.' }; }

  const check = await verifyPassword(password, row.password, row.password_salt);
  if (!check.valid) { await recordFailedLogin(adminId); return { success: false, message: 'Incorrect Admin ID or password.' }; }
  await clearFailedLogins(adminId);

  if (check.upgradeNeeded) await upgradeToBcrypt('admins', 'admin_id', adminId, password);
  if (row.status !== 'Active') {
    return { success: false, message: `This admin account is "${row.status}" and cannot log in until an active admin sets its status to Active.` };
  }

  const token = await createSession('admin', adminId, row.name, row.role);
  return { success: true, token, adminId, name: row.name, role: row.role };
}

/* =========================================================================
 * COACH LOGIN
 * ========================================================================= */

export async function coachLogin(coachId, password, ip) {
  await checkLoginIpRateLimit(ip);
  await assertNotLockedOut(coachId);
  const row = await queryOne('SELECT * FROM coach_accounts WHERE coach_id = ?', [coachId]);
  if (!row) { await recordFailedLogin(coachId); return { success: false, message: 'Incorrect Coach ID or password.' }; }

  const check = await verifyPassword(password, row.password, row.password_salt);
  if (!check.valid) { await recordFailedLogin(coachId); return { success: false, message: 'Incorrect Coach ID or password.' }; }
  await clearFailedLogins(coachId);

  if (check.upgradeNeeded) await upgradeToBcrypt('coach_accounts', 'coach_id', coachId, password);
  if (row.status !== 'Active') {
    return { success: false, message: `This coach account is "${row.status}" and cannot log in until an admin sets its status to Active.` };
  }

  const token = await createSession('coach', coachId, row.name, null);
  return { success: true, token, coachId, name: row.name };
}

/** Single entry point the login screen calls — tries Admins first, then
 *  CoachAccounts. An ID in neither gets one generic message, same as
 *  before (doesn't leak which table was checked). `ip` is the caller's
 *  address, used only for the IP-level rate limit — never stored. */
export async function login(loginId, password, ip) {
  await checkLoginIpRateLimit(ip);
  await assertNotLockedOut(loginId);

  const admin = await queryOne('SELECT admin_id FROM admins WHERE admin_id = ?', [loginId]);
  if (admin) {
    const result = await adminLogin(loginId, password, ip);
    result.accountType = 'admin';
    if (result.success) await logDashboardLogin(result.name || loginId, 'Admin');
    return result;
  }

  const coach = await queryOne('SELECT coach_id FROM coach_accounts WHERE coach_id = ?', [loginId]);
  if (coach) {
    const result = await coachLogin(loginId, password, ip);
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
    sets.push('password = ?', "password_salt = ''");
    args.push(await hashPassword(updates.password));
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
    const idNow = updates.newAdminId || info.accountId;
    await run("UPDATE admins SET password = ?, password_salt = '' WHERE admin_id = ?",
      [await hashPassword(updates.newPassword), idNow]);
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
    sets.push('password = ?', "password_salt = ''");
    args.push(await hashPassword(updates.password));
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
    const idNow = updates.newCoachId || info.accountId;
    await run("UPDATE coach_accounts SET password = ?, password_salt = '' WHERE coach_id = ?",
      [await hashPassword(updates.newPassword), idNow]);
  }

  return { success: true, requiresRelogin: idChanged };
}

/* =========================================================================
 * ACCOUNT DELETION — for actually removing a Pending/Inactive/Suspended
 * account instead of letting disabled ones pile up forever. Deliberately
 * separate from "set status" — deleting is permanent, status changes
 * aren't.
 * ========================================================================= */

/** Deletes an Admin account outright. Two safety guards, both there
 *  because an Admin account isn't just a row of data — it's a login
 *  credential, and getting this wrong can permanently lock everyone out
 *  with no recovery path (there's no "forgot password" flow, and fixing
 *  it would mean going into Turso directly):
 *   1. Can't delete your OWN currently-logged-in account — forces a
 *      DIFFERENT admin to do it, so nobody accidentally locks themselves
 *      out mid-session.
 *   2. Can't delete the LAST remaining admin account, full stop — even
 *      another admin can't do this, since it would leave literally nobody
 *      able to log into the Admin Dashboard ever again. */
export async function deleteAdmin(token, adminId) {
  const info = await requireAdmin(token);
  if (adminId === info.accountId) {
    throw new Error("You can't delete your own account while logged in as it — have a different admin do this.");
  }
  const { count } = await queryOne('SELECT COUNT(*) as count FROM admins');
  if (count <= 1) {
    throw new Error("Can't delete the last remaining admin account — this would lock everyone out of the Admin Dashboard permanently.");
  }
  const existing = await queryOne('SELECT admin_id FROM admins WHERE admin_id = ?', [adminId]);
  if (!existing) throw new Error('Admin not found: ' + adminId);

  await run('DELETE FROM sessions WHERE account_type = ? AND account_id = ?', ['admin', adminId]);
  await run('DELETE FROM admins WHERE admin_id = ?', [adminId]);
  return { success: true };
}

/** Deletes a Coach account outright. No "last one" protection needed
 *  here — Coach accounts aren't required for the system itself to keep
 *  working the way at least one Admin account is, so there's no lockout
 *  risk in deleting every single one if that's genuinely intended. No
 *  self-deletion check needed either — only an Admin token can call
 *  this at all, and an admin's own account lives in a completely
 *  separate ID space from Coach accounts, so there's no "deleting
 *  yourself" scenario possible here the way there is for deleteAdmin(). */
export async function deleteCoachAccount(token, coachId) {
  await requireAdmin(token);
  const existing = await queryOne('SELECT coach_id FROM coach_accounts WHERE coach_id = ?', [coachId]);
  if (!existing) throw new Error('Coach not found: ' + coachId);

  await run('DELETE FROM sessions WHERE account_type = ? AND account_id = ?', ['coach', coachId]);
  await run('DELETE FROM coach_accounts WHERE coach_id = ?', [coachId]);
  return { success: true };
}
