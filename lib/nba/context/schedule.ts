import { addEvidence, sources } from './evidence';
import type { BuildEnvironment, ScheduleContext } from './types';

export function basketballDate(timestamp: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
}
const calendarDays = (first: string, second: string) => (Date.parse(`${basketballDate(second)}T12:00:00Z`) - Date.parse(`${basketballDate(first)}T12:00:00Z`)) / 86400000;

export function buildSchedule(env: BuildEnvironment): ScheduleContext {
  const { target } = env.snapshot;
  const homeAway = target.neutralSite === true ? 'UNKNOWN' : env.request.teamId === target.homeTeamId ? 'HOME' : env.request.teamId === target.awayTeamId ? 'AWAY' : 'UNKNOWN';
  const calendar = env.snapshot.calendar.filter(game => game.gameId !== target.gameId && game.seasonId === target.seasonId && game.phase === target.phase
    && (game.homeTeamId === env.request.teamId || game.awayTeamId === env.request.teamId)
    && Date.parse(game.startsAt) < Date.parse(target.startsAt) && Date.parse(game.source.fetchedAt) <= Date.parse(env.cutoff)).sort((first, second) => first.startsAt.localeCompare(second.startsAt));
  const last = calendar.at(-1);
  const lastCompleted = env.teamGames.at(-1);
  const density = Object.fromEntries([4, 7, 10, 14].map(days => [String(days), calendar.filter(game => {
    const gap = calendarDays(game.startsAt, target.startsAt);
    return gap >= 0 && gap < days;
  }).length + 1]));
  const evidenceIds = [addEvidence(env, { id: 'schedule.homeAway', metric: 'designatedHomeAway', kind: 'FACT', value: { designated: homeAway, neutralSite: target.neutralSite },
    detail: 'Designated venue side; a neutral venue is not ordinary home-court context.', sourceRefs: [target.source], correlationGroup: 'schedule.environment' })];
  evidenceIds.push(addEvidence(env, { id: 'schedule.rest', metric: 'scheduledRest', value: last ? { backToBack: calendarDays(last.startsAt, target.startsAt) === 1,
    interveningDays: Math.max(0, calendarDays(last.startsAt, target.startsAt) - 1), hoursBetweenScheduledStarts: (Date.parse(target.startsAt) - Date.parse(last.startsAt)) / 3600000,
    previousGameId: last.gameId, previousCompletedByCutoff: env.games.some(game => game.gameId === last.gameId), densityIncludingTarget: density } : null,
    detail: 'Eastern basketball dates define scheduled back-to-backs. Counts are covered schedule events, not guaranteed rest or player fatigue. A pending previous game is not a completed workload.',
    sourceRefs: sources([...calendar, target]), state: 'PARTIAL', reliabilityReasons: ['Schedule coverage may be incomplete; density is a covered-event count.'], correlationGroup: 'schedule.environment' }));
  evidenceIds.push(addEvidence(env, { id: 'schedule.travel', metric: 'venueSequence', value: lastCompleted ? { priorGameId: lastCompleted.gameId, priorVenueId: lastCompleted.venueId, targetVenueId: target.venueId,
    changedVenue: lastCompleted.venueId && target.venueId ? lastCompleted.venueId !== target.venueId : null } : null,
    detail: 'Observed last completed venue to target venue; actual itinerary, distance, arrival time and fatigue effects unavailable.', sourceRefs: sources(lastCompleted ? [lastCompleted, target] : [target]), correlationGroup: 'schedule.environment' }));
  return { homeAway, evidenceIds };
}