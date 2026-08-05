import { getPublicPlayers } from './players.js';
import { getAllTrainings, getUpcomingTrainings, getUpcomingTournaments, getAllTournaments, getTrainingPresets } from './schedule.js';
import { getAllAchievements, getAllGallery, getAllTeam } from './content.js';
import { getAllCoaches, getAllManagement } from './staff.js';
import { getClubRegistrationInfo } from './club-registration.js';

export async function getStatistics() {
  const publicPlayers = await getPublicPlayers();
  // getPublicPlayers already excludes Pending, so pendingPlayers needs the
  // full count separately for the admin-facing stat — reuse the same
  // module's internal knowledge rather than re-querying here.
  const { getPlayers } = await import('./players.js');
  const trainings = await getAllTrainings();
  const tournaments = await getAllTournaments();

  const categories = {};
  let activeCount = 0;
  publicPlayers.forEach((p) => {
    categories[p.category] = (categories[p.category] || 0) + 1;
    if (p.status === 'Active') activeCount++;
  });

  const upcomingCount = trainings.filter((t) => t.status === 'Upcoming').length;
  const upcomingTournamentCount = tournaments.filter((t) => t.status === 'Upcoming').length;

  return {
    totalPlayers: publicPlayers.length,
    activePlayers: activeCount,
    upcomingTrainings: upcomingCount,
    upcomingTournaments: upcomingTournamentCount,
    totalCategories: Object.keys(categories).length,
    categoryBreakdown: categories
  };
}

/** FIRST-PAINT DATA ONLY — hero, stats, and player grid. Nothing else,
 *  same split as the old backend for the same reason: get the public page
 *  painting before Gallery/Team/Achievements/Coaches/Management/Club
 *  Registration/Presets (none of which block first paint) are fetched. */
export async function getDashboardDataCore() {
  const [players, statistics, trainings, tournaments] = await Promise.all([
    getPublicPlayers(), getStatistics(), getUpcomingTrainings(), getUpcomingTournaments()
  ]);
  return { players, statistics, trainings, tournaments };
}

/** Everything else — fetched right after first paint, non-blocking. */
export async function getDashboardDataExtra(token) {
  const [achievements, gallery, team, coaches, management, clubRegistration, trainingPresets] = await Promise.all([
    getAllAchievements(), getAllGallery(), getAllTeam(), getAllCoaches(token), getAllManagement(),
    getClubRegistrationInfo(), getTrainingPresets()
  ]);
  return { achievements, gallery, team, coaches, management, ssm: clubRegistration, trainingPresets };
}

/** Legacy single-call bundle, kept for anyone hitting the API directly —
 *  the frontend itself no longer uses this on first load. */
export async function getDashboardData(token) {
  const [core, extra] = await Promise.all([getDashboardDataCore(), getDashboardDataExtra(token)]);
  return { ...core, ...extra };
}
