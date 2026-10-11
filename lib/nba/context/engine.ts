import { buildAvailability } from './availability';
import { addEvidence, freezeSnapshot, iso, priorCompleted } from './evidence';
import { buildInjuryNetwork } from './injuryNetwork';
import { buildMarketViews, buildPlayerOpportunity } from './marketViews';
import { buildNews } from './news';
import { buildOpponent } from './opponent';
import { buildRotation } from './rotation';
import { buildSchedule } from './schedule';
import { buildSeason } from './season';
import type { BuildEnvironment, NBAContextSnapshot, NBAResearchContext, ResearchRequest } from './types';

export function buildNBAResearchContext(request: ResearchRequest, snapshot: NBAContextSnapshot): NBAResearchContext {
  const asOf = iso(request.asOf);
  const snapshotTime = iso(snapshot.asOf);
  const startsAt = iso(snapshot.target.startsAt);
  if (!asOf || !snapshotTime || !startsAt || Date.parse(asOf) > Date.parse(snapshotTime)) throw new Error('Valid asOf not later than the snapshot observation time is required.');
  if (!Number.isInteger(request.playerId) || request.playerId <= 0 || !Number.isInteger(request.teamId) || request.teamId <= 0
    || request.gameId !== snapshot.target.gameId || ![snapshot.target.homeTeamId, snapshot.target.awayTeamId].includes(request.teamId)) throw new Error('Player/team/game identity must be valid and agree with the target.');
  const cutoff = new Date(Math.min(Date.parse(asOf), Date.parse(startsAt))).toISOString();
  const conflicts = new Set<string>();
  const unique = new Map<string, typeof snapshot.target>();
  for (const game of snapshot.games) {
    const existing = unique.get(game.gameId);
    if (existing && JSON.stringify({ ...existing, source: null }) !== JSON.stringify({ ...game, source: null })) conflicts.add(game.gameId);
    else unique.set(game.gameId, game);
  }
  const completed = [...unique.values()].filter(game => !conflicts.has(game.gameId) && priorCompleted(game, snapshot.target, cutoff)).sort((first, second) => first.startsAt.localeCompare(second.startsAt) || first.gameId.localeCompare(second.gameId));
  const games = completed.filter(game => game.phase === snapshot.target.phase && game.phase !== 'UNKNOWN');
  const teamGames = games.filter(game => game.homeTeamId === request.teamId || game.awayTeamId === request.teamId);
  const env: BuildEnvironment = { request, snapshot: { ...snapshot, games: completed }, cutoff, games, teamGames, evidence: [] };
  const availability = buildAvailability(env);
  const rotation = buildRotation(env);
  const injuryNetwork = buildInjuryNetwork(env);
  const schedule = buildSchedule(env);
  const opponent = buildOpponent(env);
  const season = buildSeason({ ...env, games: completed });
  const news = buildNews(env);
  buildPlayerOpportunity(env);
  const missing = [...snapshot.missing, ...[...conflicts].map(id => `Conflicting game snapshots excluded: ${id}`)];
  const excluded = [...unique.values()].filter(game => !completed.includes(game));
  if (excluded.length) missing.push(`${excluded.length} target/future/other-season/unverified/conflicted game snapshots excluded.`);
  if (snapshot.target.phase === 'UNKNOWN') missing.push('Unknown official target season phase; no historical phase blending.');
  if (!snapshot.target.seasonId) missing.push('Official target season identifier unavailable.');
  addEvidence(env, { id: 'coverage.snapshot', metric: 'snapshotCoverage', value: { completedCovered: completed.length, matchingPhase: games.length, excludedGames: excluded.map(game => game.gameId) },
    detail: 'Only unique completed games with final-period timestamp proof strictly before cutoff, same season, and target-phase matching are used for player/opponent evidence.', state: missing.length ? 'PARTIAL' : 'AVAILABLE',
    correlationGroup: 'coverage', missingReasons: missing });
  const result: NBAResearchContext = { schemaVersion: '1', sport: 'nba', playerId: request.playerId, teamId: request.teamId, gameId: request.gameId,
    seasonId: snapshot.target.seasonId, asOf, cutoff, sections: { availability, rotation, injuryNetwork, schedule, opponent, season, news },
    evidence: env.evidence, marketViews: buildMarketViews(env), coverage: { priorCompletedGames: completed.length, playerTeamGames: teamGames.length,
      opponentTeamGames: games.filter(game => game.homeTeamId === opponent.opponentTeamId || game.awayTeamId === opponent.opponentTeamId).length, missing } };
  return freezeSnapshot(JSON.parse(JSON.stringify(result)) as NBAResearchContext);
}