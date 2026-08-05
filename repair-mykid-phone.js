/**
 * ONE-TIME REPAIR — fixes MyKid / Guardian Phone for players already in
 * Turso whose data came through blank due to a header-name mismatch bug
 * (fixed in migrate.js and sync-form-submissions.js, but that fix only
 * prevents the bug going forward — it doesn't repair rows already saved
 * with the wrong data).
 *
 * Safe to re-run — every row is just UPDATEd with the correct value each
 * time, no risk of duplication. Only touches my_kid and guardian_phone;
 * nothing else about any player record is modified.
 *
 * Usage: same setup as migrate.js — needs the same .env file with
 * TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, GOOGLE_SERVICE_ACCOUNT_EMAIL,
 * GOOGLE_SERVICE_ACCOUNT_KEY, GOOGLE_SHEET_ID already in place.
 *   node repair-mykid-phone.js
 */
import 'dotenv/config';
import { google } from 'googleapis';
import { run, queryOne } from './lib/db.js';
import { getGoogleAuth, readSheet, columnIndexMap } from './lib/drive.js';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

function val(row, map, header) {
  const i = map[header];
  return i !== undefined ? (row[i] ?? '') : '';
}

async function repair() {
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const { headerRow, rows } = await readSheet(sheets, SHEET_ID, 'Form Responses 1');
  const map = columnIndexMap(headerRow);

  let checked = 0, fixed = 0, skippedNoPlayerId = 0, skippedNotInTurso = 0;

  for (const row of rows) {
    const playerId = val(row, map, 'Player ID');
    if (!playerId) { skippedNoPlayerId++; continue; }

    const existing = await queryOne('SELECT player_id, my_kid, guardian_phone FROM players WHERE player_id = ?', [playerId]);
    if (!existing) { skippedNotInTurso++; continue; }
    checked++;

    const correctMyKid = val(row, map, 'No. MyKid (Tanpa "-")');
    const correctPhone = val(row, map, 'No. Telefon Penjaga (Ibu/Bapa/Penjaga)') ||
                          val(row, map, 'No. Telefon Penjaga (Ibu/Bapa/Penjaga) (Tanpa "-")');

    const needsMyKidFix = correctMyKid && existing.my_kid !== correctMyKid;
    const needsPhoneFix = correctPhone && existing.guardian_phone !== correctPhone;

    if (!needsMyKidFix && !needsPhoneFix) continue;

    await run('UPDATE players SET my_kid = ?, guardian_phone = ? WHERE player_id = ?',
      [correctMyKid || existing.my_kid, correctPhone || existing.guardian_phone, playerId]);
    fixed++;
    console.log(`Fixed ${playerId}: myKid ${needsMyKidFix ? '(corrected)' : '(unchanged)'}, phone ${needsPhoneFix ? '(corrected)' : '(unchanged)'}`);
  }

  console.log(`\nChecked ${checked} players already in Turso, fixed ${fixed}.`);
  console.log(`(${skippedNoPlayerId} sheet rows had no Player ID yet, ${skippedNotInTurso} weren't in Turso at all — both skipped, nothing to fix there.)`);
  console.log('\nRepair complete.');
}

repair().catch((err) => {
  console.error('\nRepair failed:', err);
  process.exit(1);
});
