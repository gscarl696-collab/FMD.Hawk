/**
 * Scheduled entry point — see vercel.json for the daily schedule, and
 * lib/sync.js for the actual sync logic and full setup instructions.
 * This file's only job is being the thing Vercel Cron calls; the admin
 * dashboard's manual "Check for new registrations" button calls the same
 * lib/sync.js function directly, through the main API dispatcher instead
 * of this route (see the syncFormSubmissionsNow action in api/index.js).
 */
import { runFormSync } from '../../lib/sync.js';

export default async function handler(req, res) {
  // Vercel Cron requests carry this header automatically — reject anything
  // else so this endpoint can't be triggered by a random public request.
  if (req.headers['x-vercel-cron'] !== '1' && process.env.NODE_ENV === 'production') {
    res.status(401).json({ error: 'Unauthorized.' });
    return;
  }

  try {
    const result = await runFormSync();
    res.status(200).json(result);
  } catch (err) {
    console.error('Sync job failed:', err);
    res.status(500).json({ error: err.message });
  }
}
