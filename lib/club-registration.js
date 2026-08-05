import { queryOne, run } from './db.js';
import { requireAdmin } from './auth.js';

/** Public — no auth required. Always returns an object, even before the
 *  row has ever been set. No caching layer here (unlike the old
 *  60-second CacheService cache) — Turso reads are fast enough on their
 *  own that a cache would add complexity for no real benefit at this
 *  scale. */
export async function getClubRegistrationInfo() {
  const row = await queryOne('SELECT * FROM club_registration WHERE id = 1');
  if (!row) return { ssmNumber: '', documentUrl: '' };
  return { ssmNumber: row.ssm_number || '', documentUrl: row.document_url || '' };
}

export async function updateClubRegistrationInfo(token, updates) {
  await requireAdmin(token);
  updates = updates || {};
  const existing = await queryOne('SELECT id FROM club_registration WHERE id = 1');
  if (!existing) {
    await run('INSERT INTO club_registration (id, ssm_number, document_url) VALUES (1, ?, ?)',
      [updates.ssmNumber || '', updates.documentUrl || '']);
    return { success: true };
  }
  const sets = [], args = [];
  if (updates.ssmNumber !== undefined) { sets.push('ssm_number = ?'); args.push(updates.ssmNumber); }
  if (updates.documentUrl !== undefined) { sets.push('document_url = ?'); args.push(updates.documentUrl); }
  if (!sets.length) return { success: true };
  await run(`UPDATE club_registration SET ${sets.join(', ')} WHERE id = 1`, args);
  return { success: true };
}
