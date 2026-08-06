import { query, queryOne, run, transaction } from './db.js';
import { requireAdmin, requireStaff, isStaffToken } from './auth.js';

const AGE_TO_CATEGORY = { 6: 'U6', 7: 'U7', 8: 'U8', 9: 'U9', 10: 'U10', 11: 'U11', 12: 'U12' };

export function ageToCategory(age) {
  const n = parseInt(age, 10);
  if (AGE_TO_CATEGORY[n]) return AGE_TO_CATEGORY[n];
  if (!isNaN(n) && n < 6) return 'U6';
  if (!isNaN(n) && n > 12) return 'U12';
  return 'Unassigned';
}

export function formatPlayerId(category, num) {
  const padded = ('000' + num).slice(-3);
  return 'PLR-' + category + '-' + padded;
}

export function clampAge(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = parseInt(value, 10);
  if (isNaN(n)) return null;
  return Math.max(4, Math.min(18, n));
}

export function clampPlayerNumber(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = parseInt(value, 10);
  if (isNaN(n)) return null;
  return Math.max(0, Math.min(100, n));
}

/** Same free QR-generation API the old backend used — no need to store an
 *  image anywhere at all (Vercel Blob, Drive, or otherwise). The service
 *  regenerates the QR on the fly every time this URL is loaded, so the URL
 *  itself is the only thing that needs to be saved. Genuinely simpler than
 *  the old Drive-based approach, which had to fetch, store, and re-share
 *  a file just to end up at a URL anyway. */
export function playerQrCodeUrl(playerId) {
  if (!playerId) return '';
  return 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(playerId);
}

/** Converts a DB row (snake_case columns) into the camelCase shape the
 *  frontend already expects — unchanged from the old API's response shape
 *  on purpose, so the frontend doesn't need to change at all here. */
function rowToPlayer(row) {
  return {
    timestamp: row.timestamp || '',
    name: row.name || '',
    myKid: row.my_kid || '',
    age: row.age ?? '',
    school: row.school || '',
    guardianName: row.guardian_name || '',
    guardianPhone: row.guardian_phone || '',
    address: row.address || '',
    playerId: row.player_id,
    category: row.category || 'Unassigned',
    status: row.status || 'Pending',
    notes: row.notes || '',
    imageUrl: row.image_url || '',
    playerNumber: row.player_number ?? '',
    position: row.position || '',
    activeSince: row.active_since || '',
    qrCodeUrl: row.qr_code_url || '',
    // Sensitive documents — links stay exactly as stored (Drive "view"
    // links carried over during migration, or future Vercel Blob URLs
    // going forward), never made public the way the photo is.
    birthCertUrl: row.birth_cert_raw || '',
    mykidCopyUrl: row.mykid_copy_raw || ''
  };
}

/** Removes fields that should never reach the public dashboard. Admin and
 *  Coach tokens both bypass this. */
export function stripPrivateFields(player) {
  const copy = { ...player };
  delete copy.address;
  delete copy.myKid;
  delete copy.guardianPhone;
  delete copy.notes;
  delete copy.birthCertUrl;
  delete copy.mykidCopyUrl;
  return copy;
}

async function getAllPlayersRaw() {
  const rows = await query('SELECT * FROM players ORDER BY timestamp DESC');
  return rows.map(rowToPlayer);
}

/** Players shown on the PUBLIC dashboard. New submissions start as
 *  "Pending" and stay invisible until an admin reviews them. */
export async function getPublicPlayers() {
  const all = await getAllPlayersRaw();
  return all.filter((p) => p.status !== 'Pending').map(stripPrivateFields);
}

/** Requires an admin OR coach token. Admins see every player, including
 *  Pending ones. Coaches only ever see Active players, but see the full
 *  record (address/MyKid/guardian phone/documents) once they can see a
 *  player at all — same trust level as the old backend. */
export async function getPlayers(token) {
  const info = await requireStaff(token);
  const all = await getAllPlayersRaw();
  if (info.accountType === 'coach') {
    return all.filter((p) => p.status === 'Active');
  }
  return all;
}

/** Single-player lookup. Admin/coach tokens get the full record. Public
 *  requests get the stripped record, with School additionally hidden —
 *  the public "View Profile" card only ever shows Age, Status, Guardian
 *  Name. Pending players are invisible to everyone except admins. */
export async function getPlayer(playerId, token) {
  const row = await queryOne('SELECT * FROM players WHERE player_id = ?', [playerId]);
  if (!row) return null;
  const player = rowToPlayer(row);

  const staff = await isStaffToken(token);
  if (player.status === 'Pending' && !staff) return null; // matches old isAdminToken_ check closely enough — Pending is staff-only either way
  if (staff) return player;

  const copy = stripPrivateFields(player);
  delete copy.school;
  return copy;
}

export async function addPlayer(token, player) {
  await requireAdmin(token);

  const category = ageToCategory(player.age);
  const existing = await query("SELECT player_id FROM players WHERE category = ?", [category]);
  let highest = 0;
  existing.forEach((row) => {
    const match = String(row.player_id || '').match(/(\d+)$/);
    if (match) highest = Math.max(highest, parseInt(match[1], 10));
  });
  const playerId = formatPlayerId(category, highest + 1);

  const status = player.status || 'Active';
  const activeSince = status === 'Active' ? new Date().toISOString().slice(0, 10) : null;

  await run(
    `INSERT INTO players (
       player_id, timestamp, name, my_kid, age, school, guardian_name, guardian_phone,
       address, category, status, notes, image_url, player_number, position,
       active_since, qr_code_url
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      playerId, new Date().toISOString(), player.name || '', player.myKid || '',
      clampAge(player.age), player.school || '', player.guardianName || '', player.guardianPhone || '',
      player.address || '', category, status, player.notes || '', player.imageUrl || '',
      clampPlayerNumber(player.playerNumber), player.position || '', activeSince,
      playerQrCodeUrl(playerId)
    ]
  );

  return { success: true, playerId };
}

const EDITABLE_FIELDS = {
  name: 'name', myKid: 'my_kid', age: 'age', school: 'school',
  guardianName: 'guardian_name', guardianPhone: 'guardian_phone', address: 'address',
  status: 'status', notes: 'notes', imageUrl: 'image_url',
  playerNumber: 'player_number', position: 'position'
};

export async function updatePlayer(token, playerId, updates) {
  await requireAdmin(token);
  const existing = await queryOne('SELECT status, category FROM players WHERE player_id = ?', [playerId]);
  if (!existing) throw new Error('Player not found: ' + playerId);

  const sets = [];
  const args = [];
  let newPlayerId = playerId;
  let categoryChanged = false;
  let newCategory = existing.category;

  if (updates.age !== undefined) {
    newCategory = ageToCategory(clampAge(updates.age));
    categoryChanged = newCategory !== existing.category;
  }

  // Digital ID's "Date Issued" reflects the day the player's CURRENT
  // identity became official — re-stamped when status newly becomes
  // Active, and (see below) when a category change reissues the Player ID.
  const statusBecomingActive = updates.status === 'Active' && existing.status !== 'Active';
  if (statusBecomingActive || categoryChanged) {
    sets.push('active_since = ?');
    args.push(new Date().toISOString().slice(0, 10));
  }

  Object.keys(updates).forEach((key) => {
    if (!(key in EDITABLE_FIELDS)) return;
    const col = EDITABLE_FIELDS[key];
    let value = updates[key];
    if (key === 'playerNumber') value = clampPlayerNumber(value);
    else if (key === 'age') value = clampAge(value);
    sets.push(col + ' = ?');
    args.push(value);
  });

  if (updates.age !== undefined) {
    sets.push('category = ?');
    args.push(newCategory);
  }

  // A category change means the current Player ID's category prefix
  // (e.g. "U7") no longer matches — reissue it in the new category,
  // continuing that category's own numbering (no overlap with players
  // already in it), same logic addPlayer() uses for a brand-new player.
  if (categoryChanged) {
    const rows = await query('SELECT player_id FROM players WHERE category = ?', [newCategory]);
    let highest = 0;
    rows.forEach((row) => {
      const match = String(row.player_id || '').match(/(\d+)$/);
      if (match) highest = Math.max(highest, parseInt(match[1], 10));
    });
    newPlayerId = formatPlayerId(newCategory, highest + 1);
    sets.push('player_id = ?', 'qr_code_url = ?');
    args.push(newPlayerId, playerQrCodeUrl(newPlayerId));
  }

  if (!sets.length) return { success: true };

  if (categoryChanged) {
    // A reissued ID is referenced by Attendance and Evaluation history —
    // both have to move to the new ID together with the player, in one
    // transaction, or those records would silently become orphaned
    // (pointing at an ID that no longer exists on any player).
    //
    // synced_form_rows is deliberately NOT included here, even though it
    // also stores a player_id column — it's not player data, it's an
    // internal marker for "this Google Sheet row has already been synced,
    // don't process it again." The Sheet itself never learns a player's ID
    // changed (nothing writes back to it), so this table has to stay keyed
    // to the ORIGINAL Sheet-assigned ID forever to keep meaning what it's
    // supposed to mean — updating it here would both risk exactly the kind
    // of collision that just crashed this save, and (worse) let a future
    // sync run see the original ID as "never processed" and recreate a
    // duplicate ghost player for the same registration.
    await transaction([
      { sql: `UPDATE players SET ${sets.join(', ')} WHERE player_id = ?`, args: [...args, playerId] },
      { sql: 'UPDATE attendance SET player_id = ? WHERE player_id = ?', args: [newPlayerId, playerId] },
      { sql: 'UPDATE evaluations SET player_id = ? WHERE player_id = ?', args: [newPlayerId, playerId] }
    ]);
    return { success: true, playerId: newPlayerId, idChanged: true, previousPlayerId: playerId };
  }
  args.push(playerId);
  await run(`UPDATE players SET ${sets.join(', ')} WHERE player_id = ?`, args);
  return { success: true };
}

export async function deletePlayer(token, playerId) {
  await requireAdmin(token);
  const result = await run('DELETE FROM players WHERE player_id = ?', [playerId]);
  if (result.rowsAffected === 0) throw new Error('Player not found: ' + playerId);
  return { success: true };
}
