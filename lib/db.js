/**
 * Turso (libSQL) client. Reads connection details from environment
 * variables, which you'll set in the Vercel project's Settings ->
 * Environment Variables (never commit these to the repo):
 *
 *   TURSO_DATABASE_URL   e.g. libsql://your-db-name.turso.io
 *   TURSO_AUTH_TOKEN     from `turso db tokens create your-db-name`
 */
import { createClient } from '@libsql/client';

let _client = null;

export function getDb() {
  if (_client) return _client;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    throw new Error('Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN environment variables.');
  }
  _client = createClient({ url, authToken });
  return _client;
}

/** Runs a single SQL statement and returns its rows as plain objects
 *  (libSQL returns a slightly different row shape by default). */
export async function query(sql, args = []) {
  const db = getDb();
  const result = await db.execute({ sql, args });
  return result.rows.map(rowToObject);
}

/** Same as query(), but only returns the first row (or null). Convenient
 *  for the very common "look up one record by ID" pattern. */
export async function queryOne(sql, args = []) {
  const rows = await query(sql, args);
  return rows[0] || null;
}

/** Runs an INSERT/UPDATE/DELETE. Returns { rowsAffected, lastInsertRowid }. */
export async function run(sql, args = []) {
  const db = getDb();
  const result = await db.execute({ sql, args });
  return { rowsAffected: result.rowsAffected, lastInsertRowid: result.lastInsertRowid };
}

/** Runs several statements as a single atomic transaction — use this for
 *  anything that touches more than one table (e.g. delete-with-cascade),
 *  so a failure partway through can't leave things half-changed. */
export async function transaction(statements) {
  const db = getDb();
  const tx = await db.transaction('write');
  try {
    for (const { sql, args } of statements) {
      await tx.execute({ sql, args: args || [] });
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

function rowToObject(row) {
  // libSQL rows already behave like plain objects with column-name keys,
  // but this keeps a single place to adjust that if it ever changes.
  return { ...row };
}
