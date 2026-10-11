import { describe, expect, it } from 'vitest';
import { buildNFLPerformanceReport, recentPublicRows } from './aggregate';
import { createSnapshot } from './core';
import type { NFLLedgerCandidateInput, NFLPredictionRecord } from './types';

function record(options: { grade: NFLPredictionRecord['currentGrade']; tier?: string; probability?: number | null; odds?: number; mode?: 'STANDARD' | 'DEEP'; pregame?: 'PREGAME_VALID' | 'POST_KICKOFF' | 'KICKOFF_UNVERIFIED'; actual?: number | null }): NFLPredictionRecord {
  const candidate: NFLLedgerCandidateInput = { candidateId: 'candidate', gameId: 'game', playerId: 1, player: 'Player', market: 'Passing Yards', marketKey: 'player_pass_yds',
    line: 200.5, direction: 'over', book: 'Book', odds: options.odds ?? -110, projection: 220, trueProbability: (options.probability ?? 0.6) * 100,
    edge: 20, evPercent: 8, researchScore: 80, trapRisk: 10, pickTier: options.tier ?? 'ELITE', game: { id: 'game', gameTime: '2026-10-11T17:00:00Z', season: 2026, week: 5, seasonType: 'REGULAR', completed: false } };
  const snapshot = createSnapshot(candidate, { presentedAt: '2026-10-07T12:00:00Z', researchSessionId: null, rankingIntent: 'BEST', researchMode: options.mode ?? 'STANDARD',
    kickoff: options.pregame === 'KICKOFF_UNVERIFIED' ? null : { time: '2026-10-11T17:00:00Z', source: 'ESPN' } });
  snapshot.pregameStatus = options.pregame ?? 'PREGAME_VALID';
  const actual = options.actual !== undefined ? options.actual : options.grade === 'WIN' ? 300 : options.grade === 'LOSS' ? 100 : null;
  return { snapshot, currentGrade: options.grade, currentActual: actual, currentRevisionId: null };
}

describe('NFL ledger aggregation', () => {
  it('calculates record, pushes, payout-based ROI and omits invalid pregame rows', () => {
    const report = buildNFLPerformanceReport([
      record({ grade: 'WIN', odds: -110 }), record({ grade: 'LOSS' }), record({ grade: 'PUSH' }),
      record({ grade: 'WIN', pregame: 'POST_KICKOFF' }), record({ grade: 'WIN', pregame: 'KICKOFF_UNVERIFIED' }),
      record({ grade: 'PENDING' }), record({ grade: 'UNGRADABLE' }), record({ grade: 'VOID' }),
    ]);
    expect(report.overall).toMatchObject({ sampleSize: 2, wins: 1, losses: 1, pushes: 1, units: expect.closeTo(100 / 110 - 1), roiPercent: expect.closeTo((100 / 110 - 1) / 2 * 100) });
    expect(report.counts).toMatchObject({ totalForwardPregame: 6, graded: 3, pending: 1, ungradable: 1, void: 1, excludedPostKickoff: 1, excludedKickoffUnverified: 1 });
  });

  it('reports NUKE independently, probability buckets, mode comparison and offline calibration', () => {
    const report = buildNFLPerformanceReport([
      record({ grade: 'WIN', tier: 'NUKE', probability: 0.91, odds: 150 }),
      record({ grade: 'LOSS', tier: 'ELITE', probability: 0.65, mode: 'DEEP' }),
      record({ grade: 'WIN', tier: 'NUKE', probability: 0.55, pregame: 'KICKOFF_UNVERIFIED' }),
    ]);
    expect(report.nuke).toMatchObject({ sampleSize: 1, wins: 1, losses: 0, roiPercent: 150, averagePredictedProbability: 0.91, actualHitRate: 1, separateFromOverall: true });
    expect(report.probabilityBuckets['90%+'].sampleSize).toBe(1);
    expect(report.probabilityBuckets['60-69%'].sampleSize).toBe(1);
    expect(report.standardVsDeep.STANDARD.sampleSize).toBe(1);
    expect(report.standardVsDeep.DEEP.sampleSize).toBe(1);
    expect(report.byRankingIntent.BEST.sampleSize).toBe(2);
    expect(report.bySeasonPhase.REGULAR.sampleSize).toBe(2);
    expect(report.byDirection.OVER.sampleSize).toBe(2);
    expect(report.byMarket['Passing Yards'].sampleSize).toBe(2);
    expect(report.calibration.status).toBe('OFFLINE_ONLY_UNVALIDATED');
    expect(report.calibration.sampleSize).toBe(2);
    expect(report.sampleWarning).toMatch(/Insufficient sample/);
  });

  it('keeps recent snapshots empty and does not advertise historical rows', () => {
    expect(recentPublicRows([])).toEqual([]);
    expect(buildNFLPerformanceReport([]).overall.hitRate).toBeNull();
  });
});
