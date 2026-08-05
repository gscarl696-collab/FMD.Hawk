import { query, run } from './db.js';
import { requireAdmin } from './auth.js';
import crypto from 'node:crypto';

/** Internal helper — not exposed as its own API action, same as the old
 *  addNotification_. Used by CRUD flows that should surface an alert (and,
 *  going forward, by the Sheets sync job when a new form registration
 *  comes in — see sync.js). */
export async function addNotification(type, message, playerId) {
  const id = 'NTF-' + crypto.randomUUID().slice(0, 8);
  await run('INSERT INTO notifications (notification_id, type, message, player_id, timestamp, read) VALUES (?, ?, ?, ?, ?, 0)',
    [id, type, message, playerId || '', new Date().toISOString()]);
}

function rowToNotification(row) {
  return {
    notificationId: row.notification_id, type: row.type, message: row.message,
    playerId: row.player_id || '', timestamp: row.timestamp, read: !!row.read
  };
}

export async function getNotifications(token) {
  await requireAdmin(token);
  const rows = await query('SELECT * FROM notifications ORDER BY timestamp DESC');
  return rows.map(rowToNotification);
}

export async function markNotificationRead(token, notificationId) {
  await requireAdmin(token);
  await run('UPDATE notifications SET read = 1 WHERE notification_id = ?', [notificationId]);
  return { success: true };
}

export async function markAllNotificationsRead(token) {
  await requireAdmin(token);
  await run('UPDATE notifications SET read = 1');
  return { success: true };
}

export async function deleteNotification(token, notificationId) {
  await requireAdmin(token);
  await run('DELETE FROM notifications WHERE notification_id = ?', [notificationId]);
  return { success: true };
}
