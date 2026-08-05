import { google } from 'googleapis';
import { put } from '@vercel/blob';

export function getGoogleAuth() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '').replace(/\\n/g, '\n');
  if (!email || !key) throw new Error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_SERVICE_ACCOUNT_KEY.');
  return new google.auth.JWT({
    email, key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly', 'https://www.googleapis.com/auth/drive.readonly']
  });
}

/** Extracts a Drive file ID out of any of the URL shapes this app
 *  produces — the raw form-upload link, the processed thumbnail link, or
 *  a plain file ID by itself. Mirrors the old backend's
 *  extractDriveFileId_. */
export function extractDriveFileId(text) {
  if (!text) return '';
  const first = String(text).split(',')[0].trim();
  const match = first.match(/[-\w]{25,}/);
  return match ? match[0] : '';
}

/** Downloads a Drive file's bytes via the service account and re-uploads
 *  it to Vercel Blob, returning the new public URL. Returns '' on any
 *  failure — a missing/inaccessible file shouldn't halt a whole sync or
 *  migration run over one bad record. */
export async function copyDriveFileToBlob(drive, urlOrId, blobPathPrefix) {
  const fileId = extractDriveFileId(urlOrId);
  if (!fileId) return '';
  try {
    const meta = await drive.files.get({ fileId, fields: 'name, mimeType' });
    const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
    const bytes = Buffer.from(res.data);
    const safeName = (meta.data.name || fileId).replace(/[^a-zA-Z0-9._-]/g, '_');
    const blob = await put(`${blobPathPrefix}/${Date.now()}-${safeName}`, bytes, {
      access: 'public',
      contentType: meta.data.mimeType || 'application/octet-stream'
    });
    return blob.url;
  } catch (err) {
    console.error(`Failed to copy Drive file ${fileId} to Blob:`, err.message);
    return '';
  }
}

/** Drive "view" link, unchanged — for sensitive documents that stay off
 *  Blob's public storage on purpose (birth certs, MyKid copies), same
 *  privacy posture as the old driveViewLink_(). */
export function driveViewLink(urlOrId) {
  const fileId = extractDriveFileId(urlOrId);
  return fileId ? `https://drive.google.com/file/d/${fileId}/view` : '';
}

/** Reads an entire sheet tab as an array of row arrays, first row as
 *  headers stripped off separately — the shape every migration/sync step
 *  below works from. */
export async function readSheet(sheets, spreadsheetId, sheetName) {
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId, range: `'${sheetName}'!A1:Z`
  });
  const [headerRow, ...rows] = data.values || [];
  return { headerRow: headerRow || [], rows };
}

/** Builds a { headerText: columnIndex } map from a header row, trimmed —
 *  the same pattern every *ColumnMap_ function in GS.txt used. */
export function columnIndexMap(headerRow) {
  const map = {};
  headerRow.forEach((h, i) => { if (h) map[String(h).trim()] = i; });
  return map;
}
