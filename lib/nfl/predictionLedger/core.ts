import { createHash, randomUUID } from 'node:crypto';
import { getNFLMarketHistoricalValue } from '../oddsTypes';
import type { NFLGameLogEntry } from '../types';
import type { NFLGradeRevision, NFLLedgerCandidateInput, NFLLedgerGrade, NFLPredictionRecord, NFLPredictionSnapshot, NFLPregameStatus, NFLRankingIntent, NFLResearchMode } from './types';
import { NFL_LEDGER_GRADING_VERSION, NFL_LEDGER_MODEL_VERSION, NFL_LEDGER_SCHEMA_VERSION } from './types';

export function americanImpliedProbability(odds: number): number {
  if (!Number.isInteger(odds) || odds === 0) throw new Error('American odds must be a non-zero integer.');
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}

export function americanNetPayout(odds: number): number {
  if (!Number.isInteger(odds) || odds === 0) throw new Error('American odds must be a non-zero integer.');
  return odds > 0 ? odds / 100 : 100 / -odds;
}

function probabilityFraction(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value < 0 || value > 100) return null;
  return value / 100;
}

export function predictionFingerprint(input: Pick<NFLPredictionSnapshot, 'modelVersion' | 'gameId' | 'playerId' | 'player' | 'marketKey' | 'direction' | 'sportsbook' | 'line' | 'americanOdds'>): string {
  const identity = [input.modelVersion, input.gameId, input.playerId ?? input.player.trim().toLowerCase(), input.marketKey,
    input.direction, input.sportsbook.trim().toLowerCase(), input.line, input.americanOdds].join('|');
  return createHash('sha256').update(identity).digest('hex');
}

export function createSnapshot(input: NFLLedgerCandidateInput, metadata: {
  presentedAt: string;
  researchSessionId: string | null;
  rankingIntent: NFLRankingIntent;
  researchMode: NFLResearchMode;
  kickoff: { time: string; source: string } | null;
}, now = new Date()): NFLPredictionSnapshot {
  if (!input.gameId || input.line == null || !Number.isFinite(input.line) || input.odds == null || !Number.isInteger(input.odds) || input.odds === 0
    || typeof input.book !== 'string' || !input.book.trim()) {
    throw new Error('Displayed NFL recommendation is missing a gradeable game, line, sportsbook, or American price.');
  }
  if (!['player_pass_yds', 'player_pass_tds', 'player_pass_completions', 'player_pass_attempts', 'player_pass_interceptions',
    'player_rush_yds', 'player_rush_attempts', 'player_rush_tds', 'player_reception_yds', 'player_receptions', 'player_reception_tds'].includes(input.marketKey)) {
    throw new Error('Displayed NFL recommendation uses a market without supported grading coverage.');
  }
  const tier = input.pickTier ?? 'ELITE';
  if (!['NUKE', 'ELITE', 'SHARP', 'EDGE', 'LEAN'].includes(tier)) throw new Error('Unsupported recommendation tier.');
  const kickoffTime = metadata.kickoff?.time ?? null;
  const kickoffMs = kickoffTime ? Date.parse(kickoffTime) : Number.NaN;
  const presentedMs = Date.parse(metadata.presentedAt);
  const capturedMs = now.getTime();
  const pregameStatus: NFLPregameStatus = !Number.isFinite(kickoffMs) ? 'KICKOFF_UNVERIFIED'
    : presentedMs >= kickoffMs || capturedMs >= kickoffMs || input.game?.completed ? 'POST_KICKOFF' : 'PREGAME_VALID';
  const pregameReason = pregameStatus === 'PREGAME_VALID' ? 'Verified ESPN scheduled kickoff is after the signed presentation and ledger capture timestamps.'
    : pregameStatus === 'POST_KICKOFF' ? 'The signed presentation or ledger capture occurred at or after scheduled kickoff, or the game was already final.'
      : 'A verified scheduled kickoff was unavailable when this recommendation was presented.';
  const marketKey = input.marketKey as NFLPredictionSnapshot['marketKey'];
  const snapshot: NFLPredictionSnapshot = {
    schemaVersion: NFL_LEDGER_SCHEMA_VERSION,
    predictionId: randomUUID(),
    lineageFromPredictionId: null,
    dedupeFingerprint: '',
    origin: 'FORWARD',
    scope: 'GLOBAL',
    createdAt: now.toISOString(),
    presentedAt: metadata.presentedAt,
    modelVersion: NFL_LEDGER_MODEL_VERSION,
    researchSessionId: metadata.researchSessionId,
    gameId: input.gameId,
    gameKickoff: Number.isFinite(kickoffMs) ? new Date(kickoffMs).toISOString() : null,
    kickoffSource: metadata.kickoff?.source ?? null,
    playerId: input.playerId ?? null,
    player: input.player,
    teamId: input.teamId ?? null,
    team: input.team ?? null,
    opponent: input.opponent ?? null,
    market: input.market,
    marketKey,
    direction: input.direction,
    line: input.line,
    sportsbook: input.book.trim(),
    americanOdds: input.odds,
    tier: tier as NFLPredictionSnapshot['tier'],
    rankingIntent: metadata.rankingIntent,
    researchMode: metadata.researchMode,
    projection: input.projection,
    modelProbability: probabilityFraction(input.modelProbability),
    displayedProbability: probabilityFraction(input.trueProbability),
    impliedProbability: americanImpliedProbability(input.odds),
    edge: input.edge,
    evPercent: input.evPercent,
    researchScore: input.researchScore,
    risk: input.trapRisk,
    season: input.game?.season ?? input.season ?? input.nflResearchProfile?.season ?? null,
    week: input.game?.week ?? input.week ?? input.nflResearchProfile?.week ?? null,
    seasonPhase: input.game?.seasonType === 'REGULAR' || input.nflResearchProfile?.seasonPhase === 'REGULAR' ? 'REGULAR'
      : input.game?.seasonType === 'POSTSEASON' || input.nflResearchProfile?.seasonPhase === 'POSTSEASON' ? 'POSTSEASON' : 'UNKNOWN',
    sportFilterVersion: input.nflResearchProfile?.sportFilterVersion ?? null,
    researchVersion: input.nflResearchProfile?.modelVersion ?? null,
    pregameStatus,
    pregameReason,
  };
  snapshot.dedupeFingerprint = predictionFingerprint(snapshot);
  return snapshot;
}

export function gradeActual(actual: number, line: number, direction: 'over' | 'under'): Exclude<NFLLedgerGrade, 'PENDING' | 'VOID' | 'UNGRADABLE'> {
  if (!Number.isFinite(actual) || !Number.isFinite(line)) throw new Error('Actual and saved line must be finite.');
  if (actual === line) return 'PUSH';
  return direction === 'over' ? actual > line ? 'WIN' : 'LOSS' : actual < line ? 'WIN' : 'LOSS';
}

export function actualForMarket(snapshot: NFLPredictionSnapshot, entry: NFLGameLogEntry): number | null {
  if (entry.gameId !== snapshot.gameId) return null;
  const value = getNFLMarketHistoricalValue(snapshot.marketKey, entry.stats);
  return value != null && Number.isFinite(value) ? value : null;
}

export function makeGradeRevision(snapshot: NFLPredictionSnapshot, actual: number, sourceSignature: string, now = new Date(), supersedesRevisionId: string | null = null): NFLGradeRevision {
  return {
    revisionId: randomUUID(), predictionId: snapshot.predictionId, revisedAt: now.toISOString(),
    grade: gradeActual(actual, snapshot.line, snapshot.direction), actual, source: 'ESPN_PLAYER_GAMELOG',
    sourceGameId: snapshot.gameId, gradingVersion: NFL_LEDGER_GRADING_VERSION,
    sourceSignature, reason: supersedesRevisionId ? 'Authoritative ESPN stat source changed; prior grade retained in the revision audit.' : null,
    supersedesRevisionId,
  };
}

export function recordFromRevision(record: NFLPredictionRecord, revision: NFLGradeRevision): NFLPredictionRecord {
  return { ...record, currentGrade: revision.grade, currentActual: revision.actual, currentRevisionId: revision.revisionId };
}
