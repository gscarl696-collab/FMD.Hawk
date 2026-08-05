import { put } from '@vercel/blob';
import { requireAdmin } from './auth.js';

/** Shared by Gallery, Meet the Team, Coach Management, Management Team,
 *  and admin-uploaded Player photos. The browser sends the file as
 *  base64; this decodes it and uploads straight to Vercel Blob, which
 *  hands back a permanent public URL immediately — no separate "make it
 *  public" step needed (unlike Drive, everything in Blob is public by
 *  default once uploaded this way).
 *
 *  Note on `square`: the old backend used Google's own image-serving URL
 *  parameters (`=w600-h600-c`) to get a resized, center-cropped thumbnail
 *  on the fly — Vercel Blob has no equivalent built in. Rather than add
 *  an image-processing step (and a new dependency) just to replicate
 *  that, this stores the original image as-is; the frontend's existing
 *  `object-fit: cover` styling on profile photos already produces the
 *  same visual square-crop result. `square` is accepted for API
 *  compatibility but currently unused. */
export async function uploadImage(token, base64Data, mimeType, filename, square) {
  await requireAdmin(token);
  if (!base64Data) throw new Error('No image data received.');
  if (!/^image\//.test(String(mimeType || ''))) throw new Error('Only image files are allowed.');

  const bytes = Buffer.from(base64Data, 'base64');
  const safeName = (filename || 'upload.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
  const blob = await put(`images/${Date.now()}-${safeName}`, bytes, {
    access: 'public',
    contentType: mimeType || 'image/jpeg'
  });
  return { success: true, url: blob.url };
}

/** Generic document upload (PDF, DOCX, etc.) — same pattern as
 *  uploadImage(), for the Club Registration certificate. */
export async function uploadDocument(token, base64Data, mimeType, filename) {
  await requireAdmin(token);
  if (!base64Data) throw new Error('No file data received.');

  const bytes = Buffer.from(base64Data, 'base64');
  const safeName = (filename || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
  const blob = await put(`documents/${Date.now()}-${safeName}`, bytes, {
    access: 'public',
    contentType: mimeType || 'application/octet-stream'
  });
  return { success: true, url: blob.url, filename: safeName };
}

/** The old backend's getImageDataUri() existed to work around Google
 *  Drive's public-sharing being unreliable across Workspace domains — it
 *  fetched the file server-side and returned a data: URI instead of
 *  hotlinking. Vercel Blob URLs are already directly, reliably public,
 *  so that workaround is unnecessary now. Kept as a same-named action
 *  (returning the URL unchanged) purely so the frontend's existing calls
 *  to it don't need to be touched during the cutover. */
export async function getImageDataUri(url) {
  return url || '';
}
