import type { NBAResearchContext, AvailabilityStatus } from '../context/types';
import type { NBAGameLogEntry } from '../types';
import type { NBAIntelligenceSnapshot, IntelligenceEvidence, Verification } from '../intelligence/types';
import type { NBAAnalyzableMarket } from '../market';
import type { NBAContextModelEvidence, NBAInjuryEvidence, NBASeasonPhase, NBAObservedGame } from './types';

export const NBA_AGENT2_ADAPTER_VERSION = 'NBA_AGENT2_CONTEXT_ADAPTER_V1' as const;

function injuryFromStatus(status: AvailabilityStatus): NBAInjuryEvidence {
  switch (status) {
    case 'OUT': return 'OUT';
    case 'DOUBTFUL': return 'DOUBTFUL';
    case 'QUESTIONABLE': return 'QUESTIONABLE';
    case 'PROBABLE': return 'PROBABLE';
    case 'AVAILABLE': return 'REPORTED_AVAILABLE';
    case 'NOT_REPORTED': return 'REPORT_MISSING';
    default: return 'UNKNOWN';
  }
}

export interface AdaptNBAAgent2ContextInput {
  researchContext: NBAResearchContext | null;
  intelligenceSnapshot?: NBAIntelligenceSnapshot | null;
  playerId: number;
  teamId: number;
  gameId: string;
  targetTipoff: string;
  targetSeason: number | null;
  targetPhase: NBASeasonPhase;
  market: NBAAnalyzableMarket;
}

export function adaptNBAAgent2Context(input: AdaptNBAAgent2ContextInput): NBAContextModelEvidence | null {
  const context = input.researchContext;
  if (!context) return null;
  const targetTime = Date.parse(input.targetTipoff);
  const targetPhase = seasonPhaseForAgent2(context.sections.season.phase, context.sections.season.round);
  const contextSeason = seasonNumberFromAgent2(context.seasonId);
  const asOfTime = Date.parse(context.asOf);
  const cutoffTime = Date.parse(context.cutoff);
  if (context.schemaVersion !== '1' || context.sport !== 'nba' || context.playerId !== input.playerId || context.teamId !== input.teamId
    || context.gameId !== input.gameId || !Number.isFinite(targetTime) || !Number.isFinite(asOfTime) || !Number.isFinite(cutoffTime)
    || asOfTime >= targetTime || cutoffTime > targetTime || targetPhase !== input.targetPhase || contextSeason !== input.targetSeason) {
    throw new Error('NBAResearchContext v1 identity, season phase, cutoff, or target validation failed.');
  }

  const marketIds = new Set(context.marketViews[input.market]?.evidenceIds ?? []);
  const contextEvidence = context.evidence.filter((entry) => marketIds.has(entry.id));
  const availabilityEvidence = context.evidence.find((entry) => entry.id === 'availability.current');
  const feedMissing = context.coverage.missing.some((reason) => /current injury feed unavailable/i.test(reason));
  let injury = feedMissing ? 'FEED_UNAVAILABLE' as const : injuryFromStatus(context.sections.availability.status);
  const intelligence = input.intelligenceSnapshot ?? null;
  let intelligenceEvidence: IntelligenceEvidence[] = [];
  let minutesRestricted = false;
  let snapshotId: string | null = null;
  const missing = [...context.coverage.missing];
  if (intelligence) {
    if (intelligence.schemaVersion !== '1' || intelligence.sport !== 'nba' || intelligence.target.gameId !== input.gameId
      || ![intelligence.target.homeTeamId, intelligence.target.awayTeamId].includes(input.teamId)
      || Date.parse(intelligence.target.startsAt) !== targetTime
      || !Number.isFinite(Date.parse(intelligence.asOf)) || Date.parse(intelligence.asOf) >= targetTime
      || Date.parse(intelligence.cutoff) > targetTime) throw new Error('NBAIntelligenceSnapshot v1 identity, cutoff, or target validation failed.');
    snapshotId = intelligence.snapshotId;
    const intelligenceIds = new Set(intelligence.marketViews[input.market]?.evidenceIds ?? []);
    intelligenceEvidence = intelligence.evidence.filter((entry) => intelligenceIds.has(entry.id));
    const currentClaims = intelligence.claims.filter((record) => record.state === 'CURRENT'
      && ['OFFICIAL', 'ATTRIBUTED_REPORT', 'CORROBORATED'].includes(record.verification as Verification)
      && record.claim.gameId === input.gameId && record.claim.teamId === input.teamId
      && (!record.claim.playerIds.length || record.claim.playerIds.includes(input.playerId)));
    for (const record of currentClaims) {
      if (record.claim.topic === 'MINUTES_RESTRICTION' && record.claim.value !== 'NO_RESTRICTION') minutesRestricted = true;
      if (record.claim.topic === 'INJURY') {
        const status = record.claim.value.trim().toUpperCase();
        if (status === 'OUT') injury = 'OUT';
        else if (status === 'DOUBTFUL') injury = 'DOUBTFUL';
        else if (status === 'QUESTIONABLE') injury = 'QUESTIONABLE';
        else if (status === 'PROBABLE') injury = 'PROBABLE';
        else if (status === 'AVAILABLE') injury = 'REPORTED_AVAILABLE';
      }
    }
    missing.push(...intelligence.coverage.missing);
  }
  if (!availabilityEvidence && injury !== 'FEED_UNAVAILABLE') injury = 'UNKNOWN';
  return {
    contextSchemaVersion: '1', intelligenceSchemaVersion: intelligence ? '1' : null,
    adapterVersion: NBA_AGENT2_ADAPTER_VERSION, gameId: input.gameId, playerId: input.playerId,
    asOf: context.asOf, cutoff: context.cutoff, injury, minutesRestricted,
    contextEvidence, intelligenceSnapshotId: snapshotId, intelligenceEvidence,
    missing: [...new Set(missing)],
  };
}

export function seasonPhaseForAgent2(phase: string, round: string | null): NBASeasonPhase {
  if (phase === 'PRESEASON') return 'PRESEASON';
  if (phase === 'REGULAR') return 'REGULAR';
  if (phase === 'POSTSEASON') return round != null && /play.?in/i.test(round) ? 'PLAY_IN' : 'POSTSEASON';
  return 'UNKNOWN';
}

export function seasonNumberFromAgent2(seasonId: string | null): number | null {
  if (!seasonId) return null;
  const match = seasonId.match(/(?:^|\D)(\d{4})(?:\D|$)/);
  return match ? Number(match[1]) : null;
}

export function nbaObservedGamesFromLogs(logs: NBAGameLogEntry[]) {
  return logs.flatMap((log) => log.season != null && log.phase != null && log.phase !== 'UNKNOWN'
    ? [{ log, season: log.season, phase: log.phase, source: 'ESPN_PLAYER_GAMELOG' }]
    : []);
}

export function nbaObservedGamesFromAgent2Snapshot(snapshot: import('../context/types').NBAContextSnapshot, playerId: number, teamId: number) {
  const rows: NBAObservedGame[] = [];
  for (const game of snapshot.games) {
    const team = game.teams.find((entry) => entry.teamId === teamId);
    const player = team?.players.find((entry) => entry.playerId === playerId);
    if (!team || !player || player.didNotPlay !== false || !game.completedAt || !game.seasonId) continue;
    const stats = player.stats;
    const sourceStats = { minutes: stats.minutes, points: stats.points, totalRebounds: stats.rebounds, assists: stats.assists,
      steals: stats.steals, blocks: stats.blocks, turnovers: stats.turnovers,
      'threePointFieldGoalsMade-threePointFieldGoalsAttempted': stats.tpm, fieldGoalAttempts: stats.fga,
      freeThrowAttempts: stats.fta, threePointAttempts: stats.tpa };
    const modelStats = Object.fromEntries(Object.entries(sourceStats).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1])));
    const season = seasonNumberFromAgent2(game.seasonId);
    if (season == null) continue;
    const opponentName = team.teamId === game.homeTeamId ? String(game.awayTeamId) : String(game.homeTeamId);
    const playerWon = game.homeScore == null || game.awayScore == null ? null
      : team.teamId === game.homeTeamId ? game.homeScore > game.awayScore : game.awayScore > game.homeScore;
    rows.push({ season, phase: seasonPhaseForAgent2(game.phase, game.round), source: game.source.id,
      log: { gameId: game.gameId, date: game.startsAt, opponent: String(game.homeTeamId === teamId ? game.awayTeamId : game.homeTeamId),
        opponentAbbreviation: opponentName, homeAway: game.homeTeamId === teamId ? 'home' as const : 'away' as const,
        result: playerWon == null ? null : playerWon ? 'W' : 'L',
        stats: modelStats } });
  }
  return rows;
}
