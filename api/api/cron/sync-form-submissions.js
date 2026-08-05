/**
 * SYNC BRIDGE — Google Form/Sheet/Drive -> Turso/Vercel Blob
 * ===========================================================================
 * Your Google Form keeps working exactly as it does today: parents submit
 * it, Apps Script's onFormSubmitHandler trigger (still installed on the
 * Sheet, untouched by this migration) assigns a Player ID, category,
 * status, QR code, and processed photo URL — all still writing into the
 * "Form Responses 1" Google Sheet, same as always.
 *
 * This job runs on a schedule (see vercel.json) and:
 *   1. Reads that Sheet for rows that already have a Player ID assigned
 *      (meaning the trigger has already processed them)
 *   2. Skips any Player ID already recorded in Turso's synced_form_rows
 *   3. For each genuinely new row: copies the photo, QR code, and any
 *      sensitive documents from Google Drive into Vercel Blob, inserts the
 *      player into Turso, and records a "new player" notification — the
 *      same three things onFormSubmitHandler's Drive/Sheet-side work used
 *      to trigger, just landing in the new system instead of the old one.
 *
 * ---------------------------------------------------------------------
 * ONE-TIME SETUP REQUIRED (Google Cloud Console):
 *   1. Create a Google Cloud project (or reuse one) and enable both the
 *      "Google Sheets API" and "Google Drive API"
 *   2. Create a Service Account, generate a JSON key for it
 *   3. Share your Google Sheet with that service account's email address
 *      (found in the JSON key as "client_email") — Viewer access is enough
 *   4. Also share the Drive folder your Form saves uploads into with that
 *      same email — this is required for birth certificates / MyKid
 *      copies specifically, since those are NOT made public-link-shared
 *      the way the profile photo is
 *   5. In Vercel's Environment Variables, set:
 *        GOOGLE_SERVICE_ACCOUNT_EMAIL   (the client_email field)
 *        GOOGLE_SERVICE_ACCOUNT_KEY     (the private_key field, keep the
 *                                        \n line breaks intact)
 *        GOOGLE_SHEET_ID                (from the Sheet's URL)
 * ---------------------------------------------------------------------
 */
import { google } from 'googleapis';
import { query, run } from '../../lib/db.js';
import { ageToCategory, playerQrCodeUrl } from '../../lib/players.js';
import { addNotification } from '../../lib/notifications.js';
import { getGoogleAuth, copyDriveFileToBlob, driveViewLink } from '../../lib/drive.js';

const PLAYERS_SHEET_NAME = 'Form Responses 1';

/** Same header-name -> internal-field-name mapping as GS.txt's
 *  PLAYER_FIELD_HEADERS/PLAYER_MANAGED_HEADERS, kept in sync manually —
 *  if a question on the Form is ever reworded, update this the same way
 *  you'd have updated that constant. */
const FIELD_HEADERS = {
  'Timestamp': 'timestamp',
  'Nama (HURUF BESAR)': 'name',
  'No. Mykid': 'myKid',
  'Umur': 'age',
  'Nama Sekolah (HURUF BESAR)': 'school',
  'Nama Penjaga (Ibu/Bapa/Penjaga) (HURUF BESAR)': 'guardianName',
  'No. Telefon Penjaga (Ibu/Bapa/Penjaga)': 'guardianPhone',
  'Alamat Tetap': 'address',
  'Gambar Pemain': 'imageRaw',
  'Salinan Surat Beranak': 'birthCertRaw',
  'Salinan MyKid Depan/Belakang': 'mykidCopyRaw',
  'Player ID': 'playerId',
  'Category': 'category',
  'Status': 'status',
  'Notes': 'notes',
  'Image URL': 'imageUrl',
  'Player Number': 'playerNumber',
  'Position': 'position',
  'Active Since': 'activeSince',
  'QR Code URL': 'qrCodeUrl'
};

export default async function handler(req, res) {
  // Vercel Cron requests carry this header automatically — reject anything
  // else so this endpoint can't be triggered by a random public request.
  if (req.headers['x-vercel-cron'] !== '1' && process.env.NODE_ENV === 'production') {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  try {
    const auth = getGoogleAuth();
    const sheets = google.sheets({ version: 'v4', auth });
    const drive = google.drive({ version: 'v3', auth });
    const sheetId = process.env.GOOGLE_SHEET_ID;

    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `'${PLAYERS_SHEET_NAME}'!A1:Z`
    });
    const [headerRow, ...rows] = data.values || [];
    if (!headerRow) { res.status(200).json({ synced: 0, message: 'Sheet is empty.' }); return; }

    const colIndex = {};
    headerRow.forEach((h, i) => { const field = FIELD_HEADERS[h.trim()]; if (field) colIndex[field] = i; });

    function val(row, field) { return colIndex[field] !== undefined ? (row[colIndex[field]] || '') : ''; }

    // Already-synced player IDs, to skip on every run.
    const syncedRows = await query('SELECT player_id FROM synced_form_rows');
    const alreadySynced = new Set(syncedRows.map((r) => r.player_id));

    let syncedCount = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const playerId = val(row, 'playerId');
      if (!playerId) continue; // trigger hasn't processed this row yet — skip until next run
      if (alreadySynced.has(playerId)) continue;

      const existingInTurso = await query('SELECT player_id FROM players WHERE player_id = ?', [playerId]);
      if (existingInTurso.length) {
        // Already there (e.g. from the one-time migration) — just record it as synced.
        await run('INSERT INTO synced_form_rows (player_id, sheet_row, synced_at) VALUES (?, ?, ?)',
          [playerId, i + 2, Math.floor(Date.now() / 1000)]).catch(() => {});
        continue;
      }

      const imageUrl = await copyDriveFileToBlob(drive, val(row, 'imageUrl') || val(row, 'imageRaw'), 'images');
      // Birth cert / MyKid copy stay as Drive "view" links (not made public,
      // matching how they've always been treated) rather than copied to
      // Blob — same privacy posture as the old driveViewLink_() approach.
      const birthCertUrl = driveViewLink(val(row, 'birthCertRaw'));
      const mykidCopyUrl = driveViewLink(val(row, 'mykidCopyRaw'));

      const age = val(row, 'age');
      const category = val(row, 'category') || ageToCategory(age);

      await run(
        `INSERT INTO players (
           player_id, timestamp, name, my_kid, age, school, guardian_name, guardian_phone,
           address, image_raw, birth_cert_raw, mykid_copy_raw, category, status, notes,
           image_url, player_number, position, active_since, qr_code_url
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          playerId, val(row, 'timestamp') || new Date().toISOString(), val(row, 'name'), val(row, 'myKid'),
          age || null, val(row, 'school'), val(row, 'guardianName'), val(row, 'guardianPhone'), val(row, 'address'),
          val(row, 'imageRaw'), birthCertUrl, mykidCopyUrl, category, val(row, 'status') || 'Pending',
          val(row, 'notes'), imageUrl || val(row, 'imageUrl'), val(row, 'playerNumber') || null,
          val(row, 'position'), val(row, 'activeSince') || null, val(row, 'qrCodeUrl') || playerQrCodeUrl(playerId)
        ]
      );

      await run('INSERT INTO synced_form_rows (player_id, sheet_row, synced_at) VALUES (?, ?, ?)',
        [playerId, i + 2, Math.floor(Date.now() / 1000)]);

      await addNotification('new_player', `New player submission: ${val(row, 'name') || 'Unnamed'}`, playerId);
      syncedCount++;
    }

    res.status(200).json({ synced: syncedCount, checked: rows.length });
  } catch (err) {
    console.error('Sync job failed:', err);
    res.status(500).json({ error: err.message });
  }
}
