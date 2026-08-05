import { query, queryOne, run } from './db.js';
import { requireStaff } from './auth.js';
import { getAllCoaches } from './staff.js';

/* =========================================================================
 * TRAINING
 * ========================================================================= */

function rowToTraining(row) {
  const categoriesRaw = String(row.category || '').trim();
  return {
    trainingId: row.training_id,
    categories: categoriesRaw ? categoriesRaw.split(',').map((c) => c.trim()).filter(Boolean) : [],
    trainingName: row.training_name,
    date: row.date || '',
    startTime: row.start_time || '',
    endTime: row.end_time || '',
    location: row.location,
    coach: row.coach,
    status: row.status,
    notes: row.notes || '',
    fullDetails: row.full_details || ''
  };
}

export async function getAllTrainings() {
  const rows = await query('SELECT * FROM training');
  return rows.map(rowToTraining).sort((a, b) => new Date(a.date) - new Date(b.date));
}

export async function getUpcomingTrainings() {
  const all = await getAllTrainings();
  return all.filter((t) => t.status === 'Upcoming');
}

export async function addTraining(token, training) {
  await requireStaff(token);
  const { count } = await queryOne('SELECT COUNT(*) as count FROM training');
  const trainingId = 'TRN-' + ('000' + (count + 1)).slice(-3);
  const categories = Array.isArray(training.categories) ? training.categories.join(',') : (training.categories || '');
  await run(
    `INSERT INTO training (training_id, category, training_name, date, start_time, end_time, location, coach, status, notes, full_details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [trainingId, categories, training.trainingName, training.date, training.startTime, training.endTime,
     training.location, training.coach, training.status || 'Upcoming', training.notes || '', training.fullDetails || '']
  );
  return { success: true, trainingId };
}

const TRAINING_FIELD_TO_COL = {
  categories: 'category', trainingName: 'training_name', date: 'date', startTime: 'start_time',
  endTime: 'end_time', location: 'location', coach: 'coach', status: 'status', notes: 'notes', fullDetails: 'full_details'
};

export async function updateTraining(token, trainingId, updates) {
  await requireStaff(token);
  const sets = [], args = [];
  Object.keys(updates).forEach((key) => {
    if (!TRAINING_FIELD_TO_COL[key]) return;
    const value = key === 'categories' && Array.isArray(updates[key]) ? updates[key].join(',') : updates[key];
    sets.push(TRAINING_FIELD_TO_COL[key] + ' = ?');
    args.push(value);
  });
  if (!sets.length) return { success: true };
  args.push(trainingId);
  const result = await run(`UPDATE training SET ${sets.join(', ')} WHERE training_id = ?`, args);
  if (result.rowsAffected === 0) throw new Error('Training not found: ' + trainingId);
  return { success: true };
}

export async function deleteTraining(token, trainingId) {
  await requireStaff(token);
  const result = await run('DELETE FROM training WHERE training_id = ?', [trainingId]);
  if (result.rowsAffected === 0) throw new Error('Training not found: ' + trainingId);
  return { success: true };
}

/* =========================================================================
 * TOURNAMENTS — same shape as Training
 * ========================================================================= */

function rowToTournament(row) {
  const categoriesRaw = String(row.categories || '').trim();
  return {
    tournamentId: row.tournament_id,
    name: row.name,
    categories: categoriesRaw ? categoriesRaw.split(',').map((c) => c.trim()).filter(Boolean) : [],
    date: row.date || '',
    startTime: row.start_time || '',
    endTime: row.end_time || '',
    location: row.location,
    status: row.status,
    notes: row.notes || '',
    fullDetails: row.full_details || ''
  };
}

export async function getAllTournaments() {
  const rows = await query('SELECT * FROM tournaments');
  return rows.map(rowToTournament).sort((a, b) => new Date(a.date) - new Date(b.date));
}

export async function getUpcomingTournaments() {
  const all = await getAllTournaments();
  return all.filter((t) => t.status === 'Upcoming');
}

export async function addTournament(token, tournament) {
  await requireStaff(token);
  const { count } = await queryOne('SELECT COUNT(*) as count FROM tournaments');
  const tournamentId = 'TRM-' + ('000' + (count + 1)).slice(-3);
  const categories = Array.isArray(tournament.categories) ? tournament.categories.join(',') : (tournament.categories || '');
  await run(
    `INSERT INTO tournaments (tournament_id, name, categories, date, start_time, end_time, location, status, notes, full_details)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [tournamentId, tournament.name, categories, tournament.date, tournament.startTime, tournament.endTime,
     tournament.location, tournament.status || 'Upcoming', tournament.notes || '', tournament.fullDetails || '']
  );
  return { success: true, tournamentId };
}

const TOURNAMENT_FIELD_TO_COL = {
  name: 'name', categories: 'categories', date: 'date', startTime: 'start_time',
  endTime: 'end_time', location: 'location', status: 'status', notes: 'notes', fullDetails: 'full_details'
};

export async function updateTournament(token, tournamentId, updates) {
  await requireStaff(token);
  const sets = [], args = [];
  Object.keys(updates).forEach((key) => {
    if (!TOURNAMENT_FIELD_TO_COL[key]) return;
    const value = key === 'categories' && Array.isArray(updates[key]) ? updates[key].join(',') : updates[key];
    sets.push(TOURNAMENT_FIELD_TO_COL[key] + ' = ?');
    args.push(value);
  });
  if (!sets.length) return { success: true };
  args.push(tournamentId);
  const result = await run(`UPDATE tournaments SET ${sets.join(', ')} WHERE tournament_id = ?`, args);
  if (result.rowsAffected === 0) throw new Error('Tournament not found: ' + tournamentId);
  return { success: true };
}

export async function deleteTournament(token, tournamentId) {
  await requireStaff(token);
  const result = await run('DELETE FROM tournaments WHERE tournament_id = ?', [tournamentId]);
  if (result.rowsAffected === 0) throw new Error('Tournament not found: ' + tournamentId);
  return { success: true };
}

/* =========================================================================
 * TRAINING PRESETS — quick-select dropdown options for the Add/Edit
 * Training and Add/Edit Tournament forms. No caching layer here (unlike
 * the old 60s CacheService cache) — Turso reads are fast enough on their
 * own, and skipping the cache avoids the "just added a preset, don't see
 * it for 60 seconds" staleness bug the old cache-invalidation dance was
 * built to work around in the first place.
 * ========================================================================= */

export async function getTrainingPresets() {
  const rows = await query('SELECT field, value FROM training_presets');
  const result = { trainingNames: [], tournamentNames: [], locations: [], coaches: [] };
  rows.forEach((row) => {
    if (row.field === 'Training Name') result.trainingNames.push(row.value);
    else if (row.field === 'Tournament Name') result.tournamentNames.push(row.value);
    else if (row.field === 'Location') result.locations.push(row.value);
    else if (row.field === 'Coach') result.coaches.push(row.value);
  });

  // Auto-include every registered coach's name, so Coach Management always
  // stays in sync with this dropdown — no manual preset entry needed.
  const coaches = await getAllCoaches();
  coaches.forEach((c) => { if (c.name && !result.coaches.includes(c.name)) result.coaches.push(c.name); });

  return result;
}

export async function addTrainingPreset(token, field, value) {
  await requireStaff(token);
  field = String(field || '').trim();
  value = String(value || '').trim();
  if (!field || !value) throw new Error('Both a field and a value are required.');

  const existing = await queryOne(
    'SELECT id FROM training_presets WHERE field = ? AND LOWER(value) = LOWER(?)', [field, value]
  );
  if (!existing) {
    await run('INSERT INTO training_presets (field, value) VALUES (?, ?)', [field, value]);
  }
  return { success: true, presets: await getTrainingPresets() };
}

export async function updateTrainingPreset(token, field, oldValue, newValue) {
  await requireStaff(token);
  field = String(field || '').trim();
  oldValue = String(oldValue || '').trim();
  newValue = String(newValue || '').trim();
  if (!field || !oldValue || !newValue) throw new Error('Field, old value, and new value are all required.');

  await run('UPDATE training_presets SET value = ? WHERE field = ? AND value = ?', [newValue, field, oldValue]);
  return { success: true, presets: await getTrainingPresets() };
}

export async function deleteTrainingPreset(token, field, value) {
  await requireStaff(token);
  field = String(field || '').trim();
  value = String(value || '').trim();
  if (!field || !value) throw new Error('Both a field and a value are required.');

  await run('DELETE FROM training_presets WHERE field = ? AND value = ?', [field, value]);
  return { success: true, presets: await getTrainingPresets() };
}
