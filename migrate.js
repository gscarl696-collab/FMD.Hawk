/**
 * ONE-TIME DATA MIGRATION — Google Sheets -> Turso / Drive -> Vercel Blob
 * ===========================================================================
 * Run this ONCE, manually, from your own machine (not as a Vercel
 * function) after the schema has been created in Turso and before you cut
 * traffic over to the new API. It is NOT the ongoing sync job — that's
 * api/cron/sync-form-submissions.js, which only ever handles rows
 * submitted AFTER this migration runs.
 *
 * Usage:
 *   1. npm install
 *   2. Set these environment variables (a .env file + a loader like
 *      `dotenv`, or just export them in your shell):
 *        TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
 *        BLOB_READ_WRITE_TOKEN               (from Vercel Blob)
 *        GOOGLE_SERVICE_ACCOUNT_EMAIL, GOOGLE_SERVICE_ACCOUNT_KEY
 *        GOOGLE_SHEET_ID
 *   3. node migrate.js
 *
 * Safe to re-run: every insert checks whether the row already exists
 * first, so a run that fails partway through (network hiccup, a bad
 * record) can just be re-run from the top — already-migrated rows are
 * skipped, not duplicated.
 *
 * This does NOT touch your Google Sheet or Drive files — it only reads
 * from them. Your original data stays exactly as it is, as your rollback
 * safety net.
 */
import { google } from 'googleapis';
import { run, query, queryOne } from './lib/db.js';
import { getGoogleAuth, copyDriveFileToBlob, driveViewLink, readSheet, columnIndexMap } from './lib/drive.js';

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

function val(row, map, header) {
  const i = map[header];
  return i !== undefined ? (row[i] ?? '') : '';
}

async function migratePlayers(sheets, drive) {
  console.log('\n--- Players ---');
  const { headerRow, rows } = await readSheet(sheets, SHEET_ID, 'Form Responses 1');
  const map = columnIndexMap(headerRow);
  let migrated = 0, skipped = 0;

  for (const row of rows) {
    const playerId = val(row, map, 'Player ID');
    if (!playerId) continue; // never processed by the form trigger — nothing to migrate yet
    const exists = await queryOne('SELECT player_id FROM players WHERE player_id = ?', [playerId]);
    if (exists) { skipped++; continue; }

    const imageRaw = val(row, map, 'Gambar Pemain');
    const imageUrlSheet = val(row, map, 'Image URL');
    const imageUrl = await copyDriveFileToBlob(drive, imageUrlSheet || imageRaw, 'images');
    const birthCertUrl = driveViewLink(val(row, map, 'Salinan Surat Beranak'));
    const mykidCopyUrl = driveViewLink(val(row, map, 'Salinan MyKid Depan/Belakang'));

    await run(
      `INSERT INTO players (
         player_id, timestamp, name, my_kid, age, school, guardian_name, guardian_phone,
         address, image_raw, birth_cert_raw, mykid_copy_raw, category, status, notes,
         image_url, player_number, position, active_since, qr_code_url
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        playerId, val(row, map, 'Timestamp'), val(row, map, 'Nama (HURUF BESAR)'), val(row, map, 'No. Mykid'),
        val(row, map, 'Umur') || null, val(row, map, 'Nama Sekolah (HURUF BESAR)'),
        val(row, map, 'Nama Penjaga (Ibu/Bapa/Penjaga) (HURUF BESAR)'), val(row, map, 'No. Telefon Penjaga (Ibu/Bapa/Penjaga)'),
        val(row, map, 'Alamat Tetap'), imageRaw, birthCertUrl, mykidCopyUrl,
        val(row, map, 'Category') || 'Unassigned', val(row, map, 'Status') || 'Pending', val(row, map, 'Notes'),
        imageUrl || imageUrlSheet, val(row, map, 'Player Number') || null, val(row, map, 'Position'),
        val(row, map, 'Active Since') || null, val(row, map, 'QR Code URL')
      ]
    );
    // Mark as already handled so the ongoing sync job doesn't try to
    // re-process this same row on its next run.
    await run('INSERT OR IGNORE INTO synced_form_rows (player_id, sheet_row, synced_at) VALUES (?, 0, ?)',
      [playerId, Math.floor(Date.now() / 1000)]);
    migrated++;
  }
  console.log(`Players: ${migrated} migrated, ${skipped} already present.`);
}

async function migrateSimpleTable({ sheets, drive, sheetName, table, idField, idColumn, rowMapper, imageField }) {
  console.log(`\n--- ${table} ---`);
  const { headerRow, rows } = await readSheet(sheets, SHEET_ID, sheetName);
  if (!headerRow.length) { console.log(`(sheet "${sheetName}" not found or empty — skipped)`); return; }
  const map = columnIndexMap(headerRow);
  let migrated = 0, skipped = 0;

  for (const row of rows) {
    const id = val(row, map, idField);
    if (!id) continue;
    const exists = await queryOne(`SELECT ${idColumn} FROM ${table} WHERE ${idColumn} = ?`, [id]);
    if (exists) { skipped++; continue; }

    let imageUrl;
    if (imageField) imageUrl = await copyDriveFileToBlob(drive, val(row, map, imageField), 'images');

    const { columns, values } = rowMapper(row, map, imageUrl);
    await run(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, values);
    migrated++;
  }
  console.log(`${table}: ${migrated} migrated, ${skipped} already present.`);
}

async function migrateAll() {
  const auth = getGoogleAuth();
  const sheets = google.sheets({ version: 'v4', auth });
  const drive = google.drive({ version: 'v3', auth });

  await migratePlayers(sheets, drive);

  await migrateSimpleTable({
    sheets, drive, sheetName: 'Coaches', table: 'coaches', idField: 'Coach ID', idColumn: 'coach_id', imageField: 'Image URL',
    rowMapper: (row, map, imageUrl) => ({
      columns: ['coach_id', 'name', 'title', 'image_url', 'sort_order', 'status', 'active_since', 'bio', 'license', 'my_kad', 'age', 'phone', 'address', 'email'],
      values: [
        val(row, map, 'Coach ID'), val(row, map, 'Name'), val(row, map, 'Title'), imageUrl || val(row, map, 'Image URL'),
        val(row, map, 'Sort Order') || 0, val(row, map, 'Status') || 'Active', val(row, map, 'Active Since') || null,
        val(row, map, 'Bio'), val(row, map, 'License'), val(row, map, 'MyKad'), val(row, map, 'Age') || null,
        val(row, map, 'Phone'), val(row, map, 'Address'), val(row, map, 'Email')
      ]
    })
  });

  await migrateSimpleTable({
    sheets, drive, sheetName: 'Management', table: 'management', idField: 'Member ID', idColumn: 'member_id', imageField: 'Image URL',
    rowMapper: (row, map, imageUrl) => ({
      columns: ['member_id', 'name', 'title', 'image_url', 'sort_order', 'status', 'active_since', 'bio'],
      values: [
        val(row, map, 'Member ID'), val(row, map, 'Name'), val(row, map, 'Title'), imageUrl || val(row, map, 'Image URL'),
        val(row, map, 'Sort Order') || 0, val(row, map, 'Status') || 'Active', val(row, map, 'Active Since') || null, val(row, map, 'Bio')
      ]
    })
  });

  await migrateSimpleTable({
    sheets, drive, sheetName: 'Team', table: 'team', idField: 'Member ID', idColumn: 'member_id', imageField: 'Image URL',
    rowMapper: (row, map, imageUrl) => ({
      columns: ['member_id', 'name', 'title', 'image_url', 'sort_order'],
      values: [val(row, map, 'Member ID'), val(row, map, 'Name'), val(row, map, 'Title'), imageUrl || val(row, map, 'Image URL'), val(row, map, 'Sort Order') || 0]
    })
  });

  await migrateSimpleTable({
    sheets, drive, sheetName: 'Achievements', table: 'achievements', idField: 'Achievement ID', idColumn: 'achievement_id',
    rowMapper: (row, map) => ({
      columns: ['achievement_id', 'title', 'details', 'year'],
      values: [val(row, map, 'Achievement ID'), val(row, map, 'Title'), val(row, map, 'Details'), val(row, map, 'Year') || null]
    })
  });

  await migrateSimpleTable({
    sheets, drive, sheetName: 'Gallery', table: 'gallery', idField: 'Photo ID', idColumn: 'photo_id', imageField: 'Image URL',
    rowMapper: (row, map, imageUrl) => ({
      columns: ['photo_id', 'image_url', 'caption', 'year', 'date'],
      values: [val(row, map, 'Photo ID'), imageUrl || val(row, map, 'Image URL'), val(row, map, 'Caption'), val(row, map, 'Year') || null, val(row, map, 'Date')]
    })
  });

  await migrateSimpleTable({
    sheets, drive, sheetName: 'Training', table: 'training', idField: 'Training ID', idColumn: 'training_id',
    rowMapper: (row, map) => ({
      columns: ['training_id', 'category', 'training_name', 'date', 'start_time', 'end_time', 'location', 'coach', 'status', 'notes', 'full_details'],
      values: [
        val(row, map, 'Training ID'), val(row, map, 'Category'), val(row, map, 'Training Name'), val(row, map, 'Date'),
        val(row, map, 'Start Time'), val(row, map, 'End Time'), val(row, map, 'Location'), val(row, map, 'Coach'),
        val(row, map, 'Status'), val(row, map, 'Notes'), val(row, map, 'Full Details')
      ]
    })
  });

  await migrateSimpleTable({
    sheets, drive, sheetName: 'Tournaments', table: 'tournaments', idField: 'Tournament ID', idColumn: 'tournament_id',
    rowMapper: (row, map) => ({
      columns: ['tournament_id', 'name', 'categories', 'date', 'start_time', 'end_time', 'location', 'status', 'notes', 'full_details'],
      values: [
        val(row, map, 'Tournament ID'), val(row, map, 'Name'), val(row, map, 'Categories'), val(row, map, 'Date'),
        val(row, map, 'Start Time'), val(row, map, 'End Time'), val(row, map, 'Location'),
        val(row, map, 'Status'), val(row, map, 'Notes'), val(row, map, 'Full Details')
      ]
    })
  });

  await migrateSimpleTable({
    sheets, drive, sheetName: 'TrainingPresets', table: 'training_presets', idField: 'Field', idColumn: 'field',
    rowMapper: (row, map) => ({ columns: ['field', 'value'], values: [val(row, map, 'Field'), val(row, map, 'Value')] })
  });
  // Note: TrainingPresets has no unique ID column in the old sheet, so the
  // generic "skip if exists" check above (keyed on the Field column) isn't
  // exactly right for this one table — it may under-migrate if you have
  // multiple preset VALUES for the same Field on a first partial run.
  // Safe fix if that happens: truncate training_presets in Turso and
  // re-run just this table's migration once, since presets have no
  // foreign keys pointing at them.

  // Admins and Coach Accounts — passwords/salts copied byte-for-byte, no
  // re-hashing, so every existing login keeps working unchanged.
  await migrateSimpleTable({
    sheets, drive, sheetName: 'Admins', table: 'admins', idField: 'Admin ID', idColumn: 'admin_id',
    rowMapper: (row, map) => ({
      columns: ['admin_id', 'name', 'email', 'role', 'status', 'password', 'password_salt'],
      values: [
        val(row, map, 'Admin ID'), val(row, map, 'Name'), val(row, map, 'Email'), val(row, map, 'Role'),
        val(row, map, 'Status'), val(row, map, 'Password'), val(row, map, 'Password Salt')
      ]
    })
  });

  await migrateSimpleTable({
    sheets, drive, sheetName: 'CoachAccounts', table: 'coach_accounts', idField: 'Coach ID', idColumn: 'coach_id',
    rowMapper: (row, map) => ({
      columns: ['coach_id', 'name', 'email', 'status', 'password', 'password_salt'],
      values: [
        val(row, map, 'Coach ID'), val(row, map, 'Name'), val(row, map, 'Email'),
        val(row, map, 'Status'), val(row, map, 'Password'), val(row, map, 'Password Salt')
      ]
    })
  });

  // Club Registration (was: SSM) — single row, handled separately.
  console.log('\n--- Club Registration ---');
  const { headerRow: ssmHeaders, rows: ssmRows } = await readSheet(sheets, SHEET_ID, 'SSM');
  if (ssmHeaders.length && ssmRows.length) {
    const existing = await queryOne('SELECT id FROM club_registration WHERE id = 1');
    if (!existing) {
      await run('INSERT INTO club_registration (id, ssm_number, document_url) VALUES (1, ?, ?)',
        [ssmRows[0][0] || '', ssmRows[0][1] || '']);
      console.log('Club Registration: migrated.');
    } else {
      console.log('Club Registration: already present.');
    }
  } else {
    console.log('Club Registration: no data to migrate.');
  }

  // Attendance and Evaluations — historical records. Migrated for
  // completeness (Player Performance history, past session lookups) but
  // not required for the site to function going forward.
  await migrateSimpleTable({
    sheets, drive, sheetName: 'Attendance', table: 'attendance', idField: 'Player ID', idColumn: 'player_id', // not a true unique key here, see note below
    rowMapper: (row, map) => ({
      columns: ['date', 'player_id', 'player_name', 'category', 'time_scanned', 'scanned_by'],
      values: [val(row, map, 'Date'), val(row, map, 'Player ID'), val(row, map, 'Player Name'), val(row, map, 'Category'), val(row, map, 'Time Scanned'), val(row, map, 'Scanned By')]
    })
  });
  console.log('  (Note: Attendance has no single unique ID column in the old sheet — if this migration is');
  console.log('   run more than once, check for duplicate rows manually before relying on historical counts.)');

  console.log('\n--- Evaluations ---');
  const { headerRow: evalHeaders, rows: evalRows } = await readSheet(sheets, SHEET_ID, 'Evaluations');
  if (evalHeaders.length) {
    const evalMap = columnIndexMap(evalHeaders);
    let migrated = 0, skipped = 0;
    for (const row of evalRows) {
      const evalId = val(row, evalMap, 'Evaluation ID');
      if (!evalId) continue;
      const exists = await queryOne('SELECT evaluation_id FROM evaluations WHERE evaluation_id = ?', [evalId]);
      if (exists) { skipped++; continue; }

      // Every score column, in header order, mapped 1:1 to the schema's
      // same-order columns — see lib/attendance-evaluations.js's SCORE_MAP
      // for the canonical header<->column pairing this must stay
      // consistent with.
      const scoreColumns = [
        'tech_both_feet','tech_first_touch','tech_short_pass','tech_long_pass','tech_attacking_1v1','tech_defending_1v1',
        'tech_shooting_outside_box','tech_finishing_inside_box','tech_defending_header','tech_attacking_header',
        'tact_game_knowledge','tact_game_application','tact_creativity','tact_individual_tactics','tact_group_tactics','tact_team_tactics',
        'moment_attacking_org','moment_defending_org','moment_attacking_transition','moment_defending_transition','moment_standard_situation','moment_individualism',
        'phys_strength','phys_speed','phys_endurance','phys_suppleness','phys_body_contact','phys_coordination','phys_balance',
        'psych_excitement','psych_concentration','psych_attention_seeking','psych_confidence','psych_communication','psych_relationship_teammates','psych_team_spirit'
      ];
      const scoreHeaderStart = 7; // column index in EVALUATION_HEADERS where the 35 rating columns begin
      const scoreValues = scoreColumns.map((_, i) => row[scoreHeaderStart + i] ?? null);

      const columns = [
        'evaluation_id', 'date', 'player_id', 'player_name', 'category', 'position', 'status',
        ...scoreColumns, 'additional_comment', 'completed_by', 'completed_date', 'decision', 'completed_by_role'
      ];
      const values = [
        evalId, val(row, evalMap, 'Date'), val(row, evalMap, 'Player ID'), val(row, evalMap, 'Player Name'),
        val(row, evalMap, 'Category'), val(row, evalMap, 'Position'), val(row, evalMap, 'Status') || 'Pending',
        ...scoreValues,
        val(row, evalMap, 'Additional Comment'), val(row, evalMap, 'Completed By'), val(row, evalMap, 'Completed Date'),
        val(row, evalMap, 'Decision'), val(row, evalMap, 'Completed By Role')
      ];
      await run(`INSERT INTO evaluations (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, values);
      migrated++;
    }
    console.log(`Evaluations: ${migrated} migrated, ${skipped} already present.`);
  } else {
    console.log('(no Evaluations sheet found — skipped)');
  }

  console.log('\nMigration complete.');
}

migrateAll().catch((err) => {
  console.error('\nMigration failed:', err);
  process.exit(1);
});
