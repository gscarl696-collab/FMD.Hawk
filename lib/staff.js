import { query, queryOne, run } from './db.js';
import { requireAdmin, isStaffToken } from './auth.js';

/* =========================================================================
 * COACHES — public "Meet the Coaches" roster (NOT login accounts —
 * see admin-accounts.js for that separate, more sensitive table).
 * ========================================================================= */

function rowToCoach(row) {
  return {
    coachId: row.coach_id, name: row.name, title: row.title || '', imageUrl: row.image_url || '',
    sortOrder: row.sort_order || 0, status: row.status || 'Active', activeSince: row.active_since || '',
    bio: row.bio || '', license: row.license || '', mykad: row.my_kad || '', age: row.age ?? '',
    phone: row.phone || '', address: row.address || '', email: row.email || ''
  };
}

/** License is intentionally kept public — everything else here is staff-only. */
function stripCoachPrivateFields(coach) {
  const copy = { ...coach };
  delete copy.mykad; delete copy.age; delete copy.phone; delete copy.address; delete copy.email;
  return copy;
}

/** Public — no auth required — but pass a valid staff token to also get
 *  MyKad/Age/Phone/Address/Email; omit it (or pass an invalid one) for the
 *  public-safe version with just License. */
export async function getAllCoaches(token) {
  const rows = await query('SELECT * FROM coaches ORDER BY sort_order ASC');
  const list = rows.map(rowToCoach);
  if (await isStaffToken(token)) return list;
  return list.map(stripCoachPrivateFields);
}

export async function addCoach(token, coach) {
  await requireAdmin(token);
  const { count } = await queryOne('SELECT COUNT(*) as count FROM coaches');
  const id = 'CO-' + ('000' + (count + 1)).slice(-3);
  const status = coach.status || 'Active';
  const activeSince = status === 'Active' ? new Date().toISOString().slice(0, 10) : null;
  await run(
    `INSERT INTO coaches (coach_id, name, title, image_url, sort_order, status, active_since, bio,
       license, my_kad, age, phone, address, email)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, coach.name, coach.title || '', coach.imageUrl || '', count, status, activeSince, coach.bio || '',
     coach.license || '', coach.mykad || '', coach.age || null, coach.phone || '', coach.address || '', coach.email || '']
  );
  return { success: true, coachId: id };
}

const COACH_FIELD_TO_COL = {
  name: 'name', title: 'title', imageUrl: 'image_url', sortOrder: 'sort_order', status: 'status',
  activeSince: 'active_since', bio: 'bio', license: 'license', mykad: 'my_kad', age: 'age',
  phone: 'phone', address: 'address', email: 'email'
};

export async function updateCoach(token, coachId, updates) {
  await requireAdmin(token);
  const existing = await queryOne('SELECT status FROM coaches WHERE coach_id = ?', [coachId]);
  if (!existing) throw new Error('Coach not found: ' + coachId);

  const sets = [], args = [];
  if (updates.status === 'Active' && existing.status !== 'Active') {
    sets.push('active_since = ?');
    args.push(new Date().toISOString().slice(0, 10));
  }
  Object.keys(updates).forEach((k) => { if (COACH_FIELD_TO_COL[k]) { sets.push(COACH_FIELD_TO_COL[k] + ' = ?'); args.push(updates[k]); } });
  if (!sets.length) return { success: true };
  args.push(coachId);
  await run(`UPDATE coaches SET ${sets.join(', ')} WHERE coach_id = ?`, args);
  return { success: true };
}

export async function reorderCoaches(token, orderedIds) {
  await requireAdmin(token);
  for (let i = 0; i < orderedIds.length; i++) {
    await run('UPDATE coaches SET sort_order = ? WHERE coach_id = ?', [i, orderedIds[i]]);
  }
  return { success: true };
}

export async function deleteCoach(token, coachId) {
  await requireAdmin(token);
  const result = await run('DELETE FROM coaches WHERE coach_id = ?', [coachId]);
  if (result.rowsAffected === 0) throw new Error('Coach not found: ' + coachId);
  return { success: true };
}

/* =========================================================================
 * MANAGEMENT — identical shape to Coaches, minus the staff-only fields.
 * ========================================================================= */

function rowToManagementMember(row) {
  return {
    memberId: row.member_id, name: row.name, title: row.title || '', imageUrl: row.image_url || '',
    sortOrder: row.sort_order || 0, status: row.status || 'Active', activeSince: row.active_since || '', bio: row.bio || ''
  };
}

export async function getAllManagement() {
  const rows = await query('SELECT * FROM management ORDER BY sort_order ASC');
  return rows.map(rowToManagementMember);
}

export async function addManagementMember(token, member) {
  await requireAdmin(token);
  const { count } = await queryOne('SELECT COUNT(*) as count FROM management');
  const id = 'MG-' + ('000' + (count + 1)).slice(-3);
  const status = member.status || 'Active';
  const activeSince = status === 'Active' ? new Date().toISOString().slice(0, 10) : null;
  await run(
    'INSERT INTO management (member_id, name, title, image_url, sort_order, status, active_since, bio) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, member.name, member.title || '', member.imageUrl || '', count, status, activeSince, member.bio || '']
  );
  return { success: true, memberId: id };
}

const MGMT_FIELD_TO_COL = { name: 'name', title: 'title', imageUrl: 'image_url', sortOrder: 'sort_order', status: 'status', activeSince: 'active_since', bio: 'bio' };

export async function updateManagementMember(token, memberId, updates) {
  await requireAdmin(token);
  const existing = await queryOne('SELECT status FROM management WHERE member_id = ?', [memberId]);
  if (!existing) throw new Error('Management member not found: ' + memberId);

  const sets = [], args = [];
  if (updates.status === 'Active' && existing.status !== 'Active') {
    sets.push('active_since = ?');
    args.push(new Date().toISOString().slice(0, 10));
  }
  Object.keys(updates).forEach((k) => { if (MGMT_FIELD_TO_COL[k]) { sets.push(MGMT_FIELD_TO_COL[k] + ' = ?'); args.push(updates[k]); } });
  if (!sets.length) return { success: true };
  args.push(memberId);
  await run(`UPDATE management SET ${sets.join(', ')} WHERE member_id = ?`, args);
  return { success: true };
}

export async function reorderManagement(token, orderedIds) {
  await requireAdmin(token);
  for (let i = 0; i < orderedIds.length; i++) {
    await run('UPDATE management SET sort_order = ? WHERE member_id = ?', [i, orderedIds[i]]);
  }
  return { success: true };
}

export async function deleteManagementMember(token, memberId) {
  await requireAdmin(token);
  const result = await run('DELETE FROM management WHERE member_id = ?', [memberId]);
  if (result.rowsAffected === 0) throw new Error('Management member not found: ' + memberId);
  return { success: true };
}
