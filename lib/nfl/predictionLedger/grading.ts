import { createHash, randomUUID } from 'node:crypto';
import { getNFLSchedule } from '../schedule';
import { getPlayerGameLogs } from '../stats';
import { actualForMarket, makeGradeRevision } from './core';
import { redisNFLLedgerRepository } from './redisStore';
import type { NFLGradeRevision, NFLPredictionRecord } from './types';

function signature(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export interface NFLGradingRunSummary {
  scanned: number;
  changed: number;
  unchanged: number;
  pending: number;
  skippedIneligible: number;
  sourceErrors: string[];
}

export async function runNFLAutomaticGrading(now = new Date()): Promise<NFLGradingRunSummary> {
  const all: NFLPredictionRecord[] = [];
  for (let offset = 0; ; offset += 250) {
    const batch = await redisNFLLedgerRepository.list({ offset, limit: 250 });
    all.push(...batch);
    if (batch.length < 250) break;
  }
  const eligible = all.filter(({ snapshot, currentGrade }) => snapshot.origin === 'FORWARD' && snapshot.pregameStatus === 'PREGAME_VALID'
    && snapshot.modelVersion === 'NFL_MODEL_V1_1_HARDENED' && currentGrade !== 'VOID');
  const summary: NFLGradingRunSummary = { scanned: eligible.length, changed: 0, unchanged: 0, pending: 0, skippedIneligible: all.length - eligible.length, sourceErrors: [] };
  const scheduleByDate = new Map<string, Awaited<ReturnType<typeof getNFLSchedule>>>();
  const logsByPlayerSeason = new Map<string, Awaited<ReturnType<typeof getPlayerGameLogs>>>();
  for (const record of eligible) {
    const { snapshot } = record;
    const date = snapshot.gameKickoff?.slice(0, 10);
    if (!date) { summary.pending += 1; continue; }
    if (!scheduleByDate.has(date)) {
      try { scheduleByDate.set(date, await getNFLSchedule({ date })); }
      catch (error) { summary.sourceErrors.push(`schedule:${date}:${error instanceof Error ? error.message : 'unavailable'}`); summary.pending += 1; continue; }
    }
    const game = scheduleByDate.get(date)?.find((entry) => entry.id === snapshot.gameId);
    if (!game?.completed) { summary.pending += 1; continue; }
    if (game.gameTime && Date.parse(game.gameTime) < Date.parse(snapshot.presentedAt)) {
      summary.skippedIneligible += 1;
      continue;
    }
    if (snapshot.playerId == null || snapshot.season == null) { summary.pending += 1; continue; }
    const playerSeason = `${snapshot.playerId}:${snapshot.season}`;
    if (!logsByPlayerSeason.has(playerSeason)) {
      try { logsByPlayerSeason.set(playerSeason, await getPlayerGameLogs(snapshot.playerId, snapshot.season)); }
      catch (error) { summary.sourceErrors.push(`gamelog:${playerSeason}:${error instanceof Error ? error.message : 'unavailable'}`); summary.pending += 1; continue; }
    }
    const entries = logsByPlayerSeason.get(playerSeason) ?? [];
    const entry = entries.find((candidate) => candidate.gameId === snapshot.gameId);
    const actual = entry ? actualForMarket(snapshot, entry) : null;
    if (actual == null) {
      const sourceSignature = signature({ gameId: snapshot.gameId, playerId: snapshot.playerId, marketKey: snapshot.marketKey,
        state: entry ? 'FINAL_STAT_MISSING' : 'PLAYER_GAMELOG_EVENT_MISSING' });
      const revision: NFLGradeRevision = {
        revisionId: randomUUID(), predictionId: snapshot.predictionId, revisedAt: now.toISOString(), grade: 'UNGRADABLE',
        actual: null, source: 'ESPN_PLAYER_GAMELOG', sourceGameId: snapshot.gameId, gradingVersion: 'NFL_ESPN_GAMELOG_V1',
        sourceSignature, reason: entry ? 'ESPN game log finalized but did not provide the required market stat; no zero was inferred.'
          : 'ESPN game log has no player event for the finalized game; participation and sportsbook void rules are unknown.',
        supersedesRevisionId: record.currentRevisionId,
      };
      const result = await redisNFLLedgerRepository.appendRevision(revision);
      if (result.created) summary.changed += 1;
      else summary.unchanged += 1;
      continue;
    }
    const sourceSignature = signature({ gameId: snapshot.gameId, playerId: snapshot.playerId, marketKey: snapshot.marketKey, actual });
    const revision = makeGradeRevision(snapshot, actual, sourceSignature, now, record.currentRevisionId);
    const result = await redisNFLLedgerRepository.appendRevision(revision);
    if (result.created) summary.changed += 1;
    else summary.unchanged += 1;
  }
  return summary;
}

export async function appendOperatorDisposition(input: { predictionId: string; grade: 'VOID' | 'UNGRADABLE'; reason: string }, now = new Date()) {
  const record = await redisNFLLedgerRepository.get(input.predictionId);
  if (!record) throw new Error('Prediction not found.');
  const reason = input.reason.trim();
  if (reason.length < 12 || reason.length > 500) throw new Error('A specific audit reason between 12 and 500 characters is required.');
  const sourceSignature = signature({ predictionId: input.predictionId, grade: input.grade, reason });
  const revision: NFLGradeRevision = {
    revisionId: randomUUID(), predictionId: input.predictionId, revisedAt: now.toISOString(), grade: input.grade,
    actual: null, source: 'OPERATOR_ADJUDICATION', sourceGameId: record.snapshot.gameId,
    gradingVersion: 'NFL_LEDGER_OPERATOR_V1', sourceSignature, reason, supersedesRevisionId: record.currentRevisionId,
  };
  return redisNFLLedgerRepository.appendRevision(revision);
}
