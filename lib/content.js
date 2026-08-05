import { query, queryOne, run } from './db.js';
import { requireAdmin } from './auth.js';

/* =========================================================================
 * ACHIEVEMENTS (Hall of Fame)
 * ========================================================================= */

function rowToAchievement(row) {
  return { achievementId: row.achievement_id, title: row.title, details: row.details || '', year: row.year };
}

export async function getAllAchievements() {
  const rows = await query('SELECT * FROM achievements ORDER BY year DESC');
  return rows.map(rowToAchievement);
}

export async function addAchievement(token, achievement) {
  await requireAdmin(token);
  const { count } = await queryOne('SELECT COUNT(*) as count FROM achievements');
  const id = 'ACH-' + ('000' + (count + 1)).slice(-3);
  await run('INSERT INTO achievements (achievement_id, title, details, year) VALUES (?, ?, ?, ?)',
    [id, achievement.title, achievement.details || '', achievement.year]);
  return { success: true, achievementId: id };
}

export async function updateAchievement(token, achievementId, updates) {
  await requireAdmin(token);
  const fieldToCol = { title: 'title', details: 'details', year: 'year' };
  const sets = [], args = [];
  Object.keys(updates).forEach((k) => { if (fieldToCol[k]) { sets.push(fieldToCol[k] + ' = ?'); args.push(updates[k]); } });
  if (!sets.length) return { success: true };
  args.push(achievementId);
  const result = await run(`UPDATE achievements SET ${sets.join(', ')} WHERE achievement_id = ?`, args);
  if (result.rowsAffected === 0) throw new Error('Achievement not found: ' + achievementId);
  return { success: true };
}

export async function deleteAchievement(token, achievementId) {
  await requireAdmin(token);
  const result = await run('DELETE FROM achievements WHERE achievement_id = ?', [achievementId]);
  if (result.rowsAffected === 0) throw new Error('Achievement not found: ' + achievementId);
  return { success: true };
}

/* =========================================================================
 * GALLERY
 * ========================================================================= */

function rowToGalleryPhoto(row) {
  return { photoId: row.photo_id, imageUrl: row.image_url, caption: row.caption || '', year: row.year, date: row.date || '' };
}

export async function getAllGallery() {
  const rows = await query('SELECT * FROM gallery ORDER BY year DESC');
  return rows.map(rowToGalleryPhoto);
}

export async function addGalleryPhoto(token, photo) {
  await requireAdmin(token);
  const date = String(photo.date || '').trim();
  if (!date) throw new Error('Please select a Gallery date.');
  const { count } = await queryOne('SELECT COUNT(*) as count FROM gallery');
  const id = 'PHO-' + ('000' + (count + 1)).slice(-3);
  const year = date ? parseInt(date.slice(0, 4), 10) : (photo.year || null);
  await run('INSERT INTO gallery (photo_id, image_url, caption, year, date) VALUES (?, ?, ?, ?, ?)',
    [id, photo.imageUrl, photo.caption || '', year, date]);
  return { success: true, photoId: id };
}

export async function updateGalleryPhoto(token, photoId, updates) {
  await requireAdmin(token);
  const fieldToCol = { imageUrl: 'image_url', caption: 'caption', year: 'year', date: 'date' };
  const sets = [], args = [];
  Object.keys(updates).forEach((k) => { if (fieldToCol[k]) { sets.push(fieldToCol[k] + ' = ?'); args.push(updates[k]); } });
  if (updates.date) { sets.push('year = ?'); args.push(parseInt(String(updates.date).slice(0, 4), 10)); }
  if (!sets.length) return { success: true };
  args.push(photoId);
  const result = await run(`UPDATE gallery SET ${sets.join(', ')} WHERE photo_id = ?`, args);
  if (result.rowsAffected === 0) throw new Error('Photo not found: ' + photoId);
  return { success: true };
}

export async function deleteGalleryPhoto(token, photoId) {
  await requireAdmin(token);
  const result = await run('DELETE FROM gallery WHERE photo_id = ?', [photoId]);
  if (result.rowsAffected === 0) throw new Error('Photo not found: ' + photoId);
  return { success: true };
}

/* =========================================================================
 * MEET THE TEAM
 * ========================================================================= */

function rowToTeamMember(row) {
  return { memberId: row.member_id, name: row.name, title: row.title || '', imageUrl: row.image_url || '', sortOrder: row.sort_order || 0 };
}

export async function getAllTeam() {
  const rows = await query('SELECT * FROM team ORDER BY sort_order ASC');
  return rows.map(rowToTeamMember);
}

export async function addTeamMember(token, member) {
  await requireAdmin(token);
  const { count } = await queryOne('SELECT COUNT(*) as count FROM team');
  const id = 'TM-' + ('000' + (count + 1)).slice(-3);
  await run('INSERT INTO team (member_id, name, title, image_url, sort_order) VALUES (?, ?, ?, ?, ?)',
    [id, member.name, member.title || '', member.imageUrl || '', count]);
  return { success: true, memberId: id };
}

export async function updateTeamMember(token, memberId, updates) {
  await requireAdmin(token);
  const fieldToCol = { name: 'name', title: 'title', imageUrl: 'image_url', sortOrder: 'sort_order' };
  const sets = [], args = [];
  Object.keys(updates).forEach((k) => { if (fieldToCol[k]) { sets.push(fieldToCol[k] + ' = ?'); args.push(updates[k]); } });
  if (!sets.length) return { success: true };
  args.push(memberId);
  const result = await run(`UPDATE team SET ${sets.join(', ')} WHERE member_id = ?`, args);
  if (result.rowsAffected === 0) throw new Error('Team member not found: ' + memberId);
  return { success: true };
}

/** Admin drag-and-drop reordering — takes the full list of member IDs in
 *  their new order and stamps each row's sort_order to match its index. */
export async function reorderTeam(token, orderedIds) {
  await requireAdmin(token);
  for (let i = 0; i < orderedIds.length; i++) {
    await run('UPDATE team SET sort_order = ? WHERE member_id = ?', [i, orderedIds[i]]);
  }
  return { success: true };
}

export async function deleteTeamMember(token, memberId) {
  await requireAdmin(token);
  const result = await run('DELETE FROM team WHERE member_id = ?', [memberId]);
  if (result.rowsAffected === 0) throw new Error('Team member not found: ' + memberId);
  return { success: true };
}
