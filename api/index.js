import { checkRateLimit } from '../lib/auth.js';
import { queryOne, run } from '../lib/db.js';

import { getDashboardData, getDashboardDataCore, getDashboardDataExtra, getStatistics } from '../lib/dashboard.js';
import {
  getPlayers, getPublicPlayers, getPlayer, addPlayer, updatePlayer, deletePlayer
} from '../lib/players.js';
import {
  getAllTrainings, getUpcomingTrainings, getAllTournaments, getUpcomingTournaments,
  addTraining, updateTraining, deleteTraining,
  addTournament, updateTournament, deleteTournament,
  getTrainingPresets, addTrainingPreset, updateTrainingPreset, deleteTrainingPreset
} from '../lib/schedule.js';
import {
  getAllAchievements, addAchievement, updateAchievement, deleteAchievement,
  getAllGallery, addGalleryPhoto, updateGalleryPhoto, deleteGalleryPhoto,
  getAllTeam, addTeamMember, updateTeamMember, deleteTeamMember, reorderTeam
} from '../lib/content.js';
import {
  getAllCoaches, addCoach, updateCoach, deleteCoach, reorderCoaches,
  getAllManagement, addManagementMember, updateManagementMember, deleteManagementMember, reorderManagement
} from '../lib/staff.js';
import { getClubRegistrationInfo, updateClubRegistrationInfo } from '../lib/club-registration.js';
import {
  login, adminLogin, coachLogin, recordDashboardLogout,
  createAdmin, updateAdminByRow, updateMyAccount, getAdmins, deleteAdmin,
  createCoachAccount, updateCoachAccountByRow, getCoachAccountsList, updateMyCoachAccount, deleteCoachAccount
} from '../lib/admin-accounts.js';
import {
  recordAttendance, getAttendanceForDate, getAttendanceSessionDates,
  getEvaluationsForDate, getEvaluationDetail, saveEvaluation,
  getPlayerPerformanceForDate, getPublicPlayerPerformance
} from '../lib/attendance-evaluations.js';
import {
  getNotifications, markNotificationRead, markAllNotificationsRead, deleteNotification
} from '../lib/notifications.js';
import { uploadImage, uploadDocument, getImageDataUri } from '../lib/images.js';
import { syncFormSubmissionsNow } from '../lib/sync.js';

/** Routes an action name + params/payload to the matching backend
 *  function — same "action router" shape the frontend's apiGet/apiPost
 *  already speak, so switching over is just a base-URL change. `ip` is
 *  the caller's address, used only for login rate-limiting — never
 *  stored or passed anywhere else. */
async function handleApiRequest(action, p, ip) {
  p = p || {};
  await checkRateLimit(p.token);

  switch (action) {
    // ---- public reads ----
    case 'getDashboardData': return getDashboardData(p.token);
    case 'getDashboardDataCore': return getDashboardDataCore();
    case 'getDashboardDataExtra': return getDashboardDataExtra(p.token);
    case 'getPlayers': return getPlayers(p.token);
    case 'getPublicPlayers': return getPublicPlayers();
    case 'getPlayer': return getPlayer(p.playerId, p.token);
    case 'getStatistics': return getStatistics();
    case 'getUpcomingTrainings': return getUpcomingTrainings();
    case 'getAllTrainings': return getAllTrainings();
    case 'getTrainingPresets': return getTrainingPresets();
    case 'addTrainingPreset': return addTrainingPreset(p.token, p.field, p.value);
    case 'updateTrainingPreset': return updateTrainingPreset(p.token, p.field, p.oldValue, p.newValue);
    case 'deleteTrainingPreset': return deleteTrainingPreset(p.token, p.field, p.value);
    case 'getUpcomingTournaments': return getUpcomingTournaments();
    case 'getAllTournaments': return getAllTournaments();
    case 'getAllAchievements': return getAllAchievements();
    case 'getAllGallery': return getAllGallery();
    case 'getAllTeam': return getAllTeam();

    // ---- admin auth ----
    case 'adminLogin': return adminLogin(p.adminId, p.password, ip);
    case 'login': return login(p.loginId, p.password, ip);
    case 'recordDashboardLogout': return recordDashboardLogout(p.token);
    case 'recordAttendance': return recordAttendance(p.token, p.date, p.playerId);
    case 'getAttendanceForDate': return getAttendanceForDate(p.token, p.date);
    case 'getAttendanceSessionDates': return getAttendanceSessionDates(p.token);
    case 'getEvaluationsForDate': return getEvaluationsForDate(p.token, p.date);
    case 'getEvaluationDetail': return getEvaluationDetail(p.token, p.evaluationId);
    case 'saveEvaluation': return saveEvaluation(p.token, p.evaluationId, p.formData);
    case 'getPlayerPerformanceForDate': return getPlayerPerformanceForDate(p.token, p.date);
    case 'getPublicPlayerPerformance': return getPublicPlayerPerformance(p.date, p.myKid);
    case 'coachLogin': return coachLogin(p.coachId, p.password, ip);
    case 'updateMyCoachAccount': return updateMyCoachAccount(p.token, p.updates);
    case 'createCoachAccount': return createCoachAccount(p.token, p.name, p.email);
    case 'updateCoachAccountByRow': return updateCoachAccountByRow(p.token, p.coachId, p.updates);
    case 'getCoachAccountsList': return getCoachAccountsList(p.token);
    case 'deleteCoachAccount': return deleteCoachAccount(p.token, p.coachId);
    case 'createAdmin': return createAdmin(p.token, p.name, p.email);
    case 'updateAdminByRow': return updateAdminByRow(p.token, p.adminId, p.updates);
    case 'updateMyAccount': return updateMyAccount(p.token, p.updates);
    case 'getAdmins': return getAdmins(p.token);
    case 'deleteAdmin': return deleteAdmin(p.token, p.adminId);
    case 'getNotifications': return getNotifications(p.token);
    case 'markNotificationRead': return markNotificationRead(p.token, p.notificationId);
    case 'markAllNotificationsRead': return markAllNotificationsRead(p.token);
    case 'deleteNotification': return deleteNotification(p.token, p.notificationId);

    // ---- admin writes: players ----
    case 'addPlayer': return addPlayer(p.token, p.player);
    case 'updatePlayer': return updatePlayer(p.token, p.playerId, p.updates);
    case 'deletePlayer': return deletePlayer(p.token, p.playerId);

    // ---- admin writes: training ----
    case 'addTraining': return addTraining(p.token, p.training);
    case 'updateTraining': return updateTraining(p.token, p.trainingId, p.updates);
    case 'deleteTraining': return deleteTraining(p.token, p.trainingId);

    // ---- admin writes: tournaments ----
    case 'addTournament': return addTournament(p.token, p.tournament);
    case 'updateTournament': return updateTournament(p.token, p.tournamentId, p.updates);
    case 'deleteTournament': return deleteTournament(p.token, p.tournamentId);

    // ---- admin writes: hall of fame / gallery / team ----
    case 'addAchievement': return addAchievement(p.token, p.achievement);
    case 'updateAchievement': return updateAchievement(p.token, p.achievementId, p.updates);
    case 'deleteAchievement': return deleteAchievement(p.token, p.achievementId);
    case 'addGalleryPhoto': return addGalleryPhoto(p.token, p.photo);
    case 'updateGalleryPhoto': return updateGalleryPhoto(p.token, p.photoId, p.updates);
    case 'deleteGalleryPhoto': return deleteGalleryPhoto(p.token, p.photoId);
    case 'addTeamMember': return addTeamMember(p.token, p.member);
    case 'updateTeamMember': return updateTeamMember(p.token, p.memberId, p.updates);
    case 'deleteTeamMember': return deleteTeamMember(p.token, p.memberId);
    case 'reorderTeam': return reorderTeam(p.token, p.orderedIds);
    case 'getAllCoaches': return getAllCoaches(p.token);
    case 'addCoach': return addCoach(p.token, p.coach);
    case 'updateCoach': return updateCoach(p.token, p.coachId, p.updates);
    case 'deleteCoach': return deleteCoach(p.token, p.coachId);
    case 'reorderCoaches': return reorderCoaches(p.token, p.orderedIds);
    case 'getAllManagement': return getAllManagement();
    case 'addManagementMember': return addManagementMember(p.token, p.member);
    case 'updateManagementMember': return updateManagementMember(p.token, p.memberId, p.updates);
    case 'deleteManagementMember': return deleteManagementMember(p.token, p.memberId);
    case 'reorderManagement': return reorderManagement(p.token, p.orderedIds);
    case 'uploadImage': return uploadImage(p.token, p.base64Data, p.mimeType, p.filename, p.square);
    case 'uploadDocument': return uploadDocument(p.token, p.base64Data, p.mimeType, p.filename);
    case 'syncFormSubmissionsNow': return syncFormSubmissionsNow(p.token);
    case 'getImageDataUri': return getImageDataUri(p.url);

    // ---- Club Registration (was: SSM) ----
    case 'getSSMInfo': return getClubRegistrationInfo();
    case 'updateSSMInfo': return updateClubRegistrationInfo(p.token, p.updates);

    default:
      throw new Error('Unknown action: ' + action);
  }
}

/** Origins allowed to call this API directly from a browser. Add a new
 *  entry here if the site ever moves to another domain or subdomain —
 *  anything not on this list gets no CORS header at all, so a browser
 *  will block the response (server-to-server calls, e.g. from Postman or
 *  another backend, aren't affected by CORS at all — this only stops
 *  *other websites* from making authenticated requests using a visitor's
 *  browser session). */
const ALLOWED_ORIGINS = [
  'https://thehawkpenang.com',
  'https://www.thehawkpenang.com',
  'https://fmd-hawk.vercel.app'
];
// Vercel preview deployments get their own random subdomain per branch/PR
// (e.g. fmd-hawk-git-somebranch-yourteam.vercel.app) — this pattern covers
// those too, so testing a preview deploy doesn't require updating this list.
const PREVIEW_ORIGIN_RE = /^https:\/\/fmd-hawk-[a-z0-9-]+\.vercel\.app$/;

function isAllowedOrigin(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.includes(origin) || PREVIEW_ORIGIN_RE.test(origin);
}

function getClientIp(req) {
  // Vercel sets x-forwarded-for; it can contain a comma-separated chain
  // if the request passed through multiple proxies — the first entry is
  // the original client.
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return String(forwarded).split(',')[0].trim();
  return req.socket?.remoteAddress || '';
}

/** Vercel serverless function entry point. Accepts both GET (public
 *  reads, action + params in the query string) and POST (writes, action +
 *  payload in a JSON body) — matching the old doGet/doPost split exactly,
 *  so the frontend's existing apiGet/apiPost helpers work unchanged
 *  beyond pointing at this URL instead of the Apps Script one. */
export default async function handler(req, res) {
  const origin = req.headers.origin;
  if (isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  // No else branch — an unrecognized origin just gets no CORS header at
  // all, which is what makes a browser block the response client-side.
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  let action, params;
  if (req.method === 'GET') {
    action = req.query.action;
    params = req.query;
  } else if (req.method === 'POST') {
    // The frontend deliberately sends Content-Type: text/plain (a trick
    // that avoided a CORS preflight Apps Script didn't handle well) —
    // Vercel's automatic body parser only auto-parses JSON for an actual
    // application/json Content-Type, so text/plain bodies arrive here as
    // a raw string instead of an object. Handle both rather than
    // requiring a frontend change just for this.
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (err) { body = {}; }
    }
    action = body?.action;
    params = body?.payload || {};
  } else {
    res.status(405).json({ error: 'Method not allowed.' });
    return;
  }

  if (!action) {
    res.status(400).json({ error: 'Missing action.' });
    return;
  }

  try {
    const data = await handleApiRequest(action, params, getClientIp(req));
    res.status(200).json({ data });
  } catch (err) {
    res.status(200).json({ error: err.message || String(err) }); // 200 on purpose — matches the old backend's shape, error is in the JSON body, not the HTTP status
  }
}
