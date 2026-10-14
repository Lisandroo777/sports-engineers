import { getNFLSchedule } from '../schedule';
import { createSnapshot } from './core';
import { redisNFLLedgerRepository } from './redisStore';
import { signPresentationReceipt, verifyPresentationReceipt } from './security';
import type { NFLLedgerCandidateInput, NFLPredictionRecord } from './types';

function isCandidate(value: unknown): value is NFLLedgerCandidateInput {
  if (!value || typeof value !== 'object') return false;
  const row = value as Partial<NFLLedgerCandidateInput>;
  return typeof row.candidateId === 'string' && typeof row.player === 'string' && typeof row.marketKey === 'string'
    && (row.direction === 'over' || row.direction === 'under');
}

export async function issueNFLPresentationReceipt(input: {
  results: unknown[];
  meta: Record<string, unknown> | null;
  researchSessionId: string | null;
  rankingIntent: 'BEST' | 'MOST_LIKELY' | 'BEST_VALUE';
  now?: Date;
}): Promise<string | null> {
  if (input.meta?.sport !== 'nfl' || !input.results.length) return null;
  const results = input.results.slice(0, 15).filter(isCandidate)
    .filter((candidate) => candidate.pickTier != null && candidate.pickTier !== 'PASS' && candidate.odds != null && candidate.odds >= -900
      && typeof candidate.book === 'string' && candidate.book.trim().length > 0);
  if (!results.length) return null;
  const dates = [...new Set(results.map((row) => row.game?.gameTime ? new Date(row.game.gameTime).toISOString().slice(0, 10) : String(input.meta?.date ?? '')))].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date));
  const games = new Map<string, { time: string; source: string; season: number | null; week: number | null; seasonType: string | null; completed: boolean }>();
  for (const date of dates) {
    try {
      const schedule = await getNFLSchedule({ date });
      for (const game of schedule) games.set(game.id, { time: game.gameTime, source: 'ESPN_SCOREBOARD', season: game.season ?? null,
        week: game.week, seasonType: game.seasonType ?? null, completed: game.completed });
    } catch {
      // Missing schedule provenance remains explicit in the signed receipt and snapshot.
    }
  }
  const mode = input.meta?.researchMode === 'STANDARD' ? 'STANDARD' : 'DEEP';
  const now = input.now ?? new Date();
  return signPresentationReceipt({ issuedAt: now.toISOString(), researchSessionId: input.researchSessionId,
    rankingIntent: input.rankingIntent, researchMode: mode,
    rows: results.map((candidate) => {
      const scheduleGame = candidate.gameId ? games.get(candidate.gameId) ?? null : null;
      const profile = candidate.nflResearchProfile;
      const snapshotInput: NFLLedgerCandidateInput = {
        candidateId: candidate.candidateId, gameId: candidate.gameId, playerId: candidate.playerId,
        player: candidate.player, teamId: candidate.teamId, team: candidate.team, opponent: candidate.opponent,
        market: candidate.market, marketKey: candidate.marketKey, line: candidate.line, direction: candidate.direction,
        book: candidate.book, odds: candidate.odds, projection: candidate.projection, trueProbability: candidate.trueProbability,
        modelProbability: candidate.modelProbability, edge: candidate.edge, evPercent: candidate.evPercent,
        researchScore: candidate.researchScore, trapRisk: candidate.trapRisk, pickTier: candidate.pickTier,
        season: candidate.season, week: candidate.week, game: candidate.game,
        ...(profile ? { nflResearchProfile: { researchMode: profile.researchMode, sportFilterVersion: profile.sportFilterVersion,
          modelVersion: profile.modelVersion, season: profile.season, week: profile.week, seasonPhase: profile.seasonPhase } } : {}),
      };
      return { candidate: { ...snapshotInput, ...(scheduleGame ? { game: { id: candidate.gameId!, gameTime: scheduleGame.time,
        season: scheduleGame.season, week: scheduleGame.week, seasonType: scheduleGame.seasonType, completed: scheduleGame.completed } } : {}) } as unknown as Record<string, unknown>,
        kickoff: scheduleGame ? { time: scheduleGame.time, source: scheduleGame.source } : null };
    }) }, now.getTime());
}

export async function captureAcknowledgedNFLRows(token: string, candidateIds: string[], now = new Date()): Promise<{ created: number; duplicates: number; records: NFLPredictionRecord[] }> {
  const receipt = verifyPresentationReceipt(token, now.getTime());
  if (!receipt) throw new Error('Invalid or expired NFL presentation receipt.');
  const allowed = new Map(receipt.rows.map((row) => [String(row.candidate.candidateId ?? ''), row]));
  const uniqueIds = [...new Set(candidateIds)].filter((id) => allowed.has(id));
  if (!uniqueIds.length) throw new Error('Acknowledged recommendation is not included in the signed presentation receipt.');
  let created = 0;
  let duplicates = 0;
  const records: NFLPredictionRecord[] = [];
  for (const id of uniqueIds) {
    const row = allowed.get(id)!;
    const snapshot = createSnapshot(row.candidate as unknown as NFLLedgerCandidateInput, {
      presentedAt: receipt.issuedAt,
      researchSessionId: receipt.researchSessionId,
      rankingIntent: receipt.rankingIntent,
      researchMode: receipt.researchMode,
      kickoff: row.kickoff,
    }, now);
    const result = await redisNFLLedgerRepository.capture(snapshot);
    if (result.created) created += 1;
    else duplicates += 1;
    records.push(result.record);
  }
  return { created, duplicates, records };
}
