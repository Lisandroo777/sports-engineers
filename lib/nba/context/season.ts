import { addEvidence, sources } from './evidence';
import type { BuildEnvironment, SeasonContext } from './types';

export function buildSeason(env: BuildEnvironment): SeasonContext {
  const { target } = env.snapshot;
  const calendar = env.snapshot.calendar.filter(game => game.seasonId === target.seasonId && game.phase === 'REGULAR'
    && (game.homeTeamId === env.request.teamId || game.awayTeamId === env.request.teamId) && Date.parse(game.source.fetchedAt) <= Date.parse(env.cutoff));
  const unique = [...new Map(calendar.map(game => [game.gameId, game])).values()];
  const completed = env.teamGames.filter(game => game.phase === 'REGULAR').length;
  const priorScheduled = unique.filter(game => Date.parse(game.startsAt) < Date.parse(env.cutoff));
  const priorCovered = priorScheduled.every(game => env.teamGames.some(completedGame => completedGame.gameId === game.gameId));
  const progressRatio = unique.length >= 82 && priorCovered ? completed / unique.length : null;
  const progress = target.phase !== 'REGULAR' || progressRatio == null ? 'UNKNOWN' : progressRatio < 1 / 3 ? 'EARLY' : progressRatio < 2 / 3 ? 'MID' : 'LATE';
  const evidenceIds = [addEvidence(env, { id: 'season.phase', metric: 'officialSeasonPhase', kind: 'FACT', value: { phase: target.phase, round: target.round },
    detail: 'Official event season-type metadata, never inferred from the date. Unknown or ambiguous rounds remain unlabeled.', sourceRefs: [target.source], correlationGroup: 'season.phase' })];
  evidenceIds.push(addEvidence(env, { id: 'season.progress', metric: 'regularSeasonProgress', value: progressRatio != null ? { label: progress, completedGames: completed, scheduledGames: unique.length, ratio: progressRatio } : null,
    detail: 'Early/mid/late describes covered schedule thirds only when an at-least-82-game regular schedule and completed-game history are available. No performance multiplier.', sourceRefs: sources(unique), correlationGroup: 'season.phase', state: 'PARTIAL' }));
  const counts = Object.fromEntries(['PRESEASON', 'REGULAR', 'POSTSEASON', 'UNKNOWN'].map(phase => [phase, env.games.filter(game => game.phase === phase).length]));
  evidenceIds.push(addEvidence(env, { id: 'season.samples', metric: 'separatePhaseSamples', kind: 'FACT', value: counts, detail: 'Covered completed games by phase; player research uses only the target phase. No career playoff sample blending.', sourceRefs: sources(env.games), correlationGroup: 'season.phase' }));
  const seriesIds = [...new Set(target.seriesEventIds)];
  const priorIds = seriesIds.filter(id => id !== target.gameId);
  const earlier = env.games.filter(game => priorIds.includes(game.gameId) && game.phase === 'POSTSEASON'
    && [game.homeTeamId, game.awayTeamId].sort().join(':') === [target.homeTeamId, target.awayTeamId].sort().join(':'));
  const unresolved = priorIds.filter(id => {
    const event = env.snapshot.calendar.find(game => game.gameId === id) ?? env.snapshot.games.find(game => game.gameId === id);
    return !event || Date.parse(event.startsAt) < Date.parse(target.startsAt) && !earlier.some(game => game.gameId === id);
  });
  const verifiedSeries = target.phase === 'POSTSEASON' && target.round != null && target.round !== 'Play-In' && seriesIds.includes(target.gameId)
    && unresolved.length === 0 && earlier.every(game => game.homeScore != null && game.awayScore != null && game.homeScore !== game.awayScore);
  let homeWins = 0;
  let awayWins = 0;
  if (verifiedSeries) for (const game of earlier) {
    const winner = game.homeScore! > game.awayScore! ? game.homeTeamId : game.awayTeamId;
    if (winner === target.homeTeamId) homeWins += 1;
    else awayWins += 1;
  }
  const possible = verifiedSeries && homeWins < 4 && awayWins < 4;
  evidenceIds.push(addEvidence(env, { id: 'season.series', metric: 'pregamePlayoffSeries', value: possible ? { homeWins, awayWins, winsRequired: 4,
    homeFacingElimination: awayWins === 3, awayFacingElimination: homeWins === 3, homeCanClinch: homeWins === 3, awayCanClinch: awayWins === 3, gamesCounted: earlier.length } : null,
    detail: 'NBA best-of-seven playoff stakes reconstructed from prior completed member events. Published cumulative series scores are deliberately ignored. Play-in and unverified series membership remain unknown.',
    sourceRefs: sources([target, ...earlier]), missingReasons: possible ? [] : ['Series identity, earlier results or round coverage incomplete; no stakes guessed.', ...unresolved.map(id => `Series member ${id}: missing or not verified as completed before cutoff.`)], correlationGroup: 'season.series' }));
  return { phase: target.phase, round: target.round, progress, evidenceIds };
}