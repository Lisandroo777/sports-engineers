import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { runAgentTurnMock } = vi.hoisted(() => ({ runAgentTurnMock: vi.fn() }));
vi.mock('../../../../lib/ai/agent/runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../lib/ai/agent/runner')>();
  return { ...actual, runAgentTurn: runAgentTurnMock };
});

import { POST } from './route';
import { toClientResult } from '../../../../lib/ai/agent/runner';
import { classifyPickTier } from '../../../../lib/ai/agent/pickTiers';
import type { ResearchCandidateRecord } from '../../../../lib/ai/agent/session';
import type { NBAProjectionResult } from '../../../../lib/nba/prediction/types';

function prediction(): NBAProjectionResult {
  return { modelVersion: 'NBA_MODEL_V1', validationStatus: 'UNVALIDATED', playerId: 10, playerName: 'Fixture Player', market: 'points',
    targetPhase: 'REGULAR', targetSeason: 2026, asOf: '2026-01-21T19:59:59.999Z', expectedMinutes: 32, minutesUncertainty: 2,
    minutesSampleSize: 20, expectedStat: 28, statUncertainty: 5, sampleSize: 20, reliability: 'MEDIUM', reasons: [],
    availableSampleSize: 20,
    historyRates: { l5: 0.8, l10: 0.7, l20: 0.65, season: 0.6 }, opportunitiesUsed: ['ESPN summary'], componentCorrelations: null,
    probabilities: { over: 0.6, under: 0.35, push: 0.05 }, quoteStatus: 'CURRENT', impliedProbability: 0.5238,
    noVigMarketProbability: 0.5, fairAmericanOdds: -171, expectedValuePercent: 14.54, directionalEdge: 7.5,
    valueQualified: true, historicalOutlierShare: 0.08, researchContextVersion: '1', intelligenceSnapshotId: 'snapshot-1',
    contextEvidence: [], intelligenceEvidence: [], contextMissing: ['No reviewed NBA news claims in configured archive.'], eligibleForReview: true };
}

function candidate() {
  return { candidateId: 'nba-1', rank: 1, playerId: 10, teamId: 1, player: 'Fixture Player', team: 'Home', opponent: 'Away',
    market: 'Points', marketKey: 'points', line: 20.5, direction: 'over' as const, book: 'Fixture Book', odds: -110, availableBooks: 1,
    projection: 28, projectionUncertainty: 5, edge: 7.5, l5Rate: 80, l10Rate: 70, l20Rate: 65, seasonRate: 60, researchScore: 90,
    signalAgreement: 6, signalsAvailable: 7, evidenceCoverage: 95, priceFreshness: 'FRESH', priceCurrent: true, trueProbability: 63.16,
    sampleSize: 20,
    modelProbability: 63.16, historicalHitRate: 70, evPercent: 14.54, priceEdgePercent: 10.78, breakEvenProbability: 52.38,
    isAlternate: false, dataQuality: 100, trapRisk: 5, qualification: 'ELITE', eliteQualified: true, valueQualified: true,
    rejectionReasons: [], pickTier: 'ELITE', tierReason: 'NBA V1 and existing Elite gates passed.', tierScore: 90,
    tierRequirementsPassed: [], tierRequirementsFailed: [], grade: 'A', priceGrade: 'A', playerEdgePercent: 10,
    projectedRange: null, bestAlternateLine: null, howItLoses: ['Minutes may differ from recent role.'],
    evidenceBoard: [], outlierDependencePercent: 8, position: 'G', modelProbabilityBasis: 'NBA_MODEL_V1 UNVALIDATED',
    nbaPrediction: prediction(), retrievedAt: '2026-01-21T19:30:00Z' };
}

beforeEach(() => { runAgentTurnMock.mockReset(); vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-21T20:00:00Z')); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('NBA DeepSide AI request response', () => {
  it('preserves NBA identity and the V1 structured prediction through the real chat POST handler', async () => {
    expect(classifyPickTier(candidate() as unknown as ResearchCandidateRecord, 'nba').pickTier).toBe('ELITE');
    const formatted = toClientResult({ reply: 'Qualified NBA research.', toolTrace: [], results: [candidate()], closestMisses: [],
      meta: { sport: 'nba', date: '2026-01-21', includePasses: false }, researchSessionId: 'research-session' }, false);
    expect(formatted.results).toHaveLength(1);
    runAgentTurnMock.mockResolvedValue({ reply: 'Qualified NBA research.', toolTrace: [], results: [candidate()], closestMisses: [],
      meta: { sport: 'nba', date: '2026-01-21', includePasses: false }, researchSessionId: 'research-session' });
    const response = await POST(new Request('http://localhost/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Best NBA player props today' }], context: { sport: 'nba', date: '2026-01-21' } }) }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.meta.sport).toBe('nba');
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ marketKey: 'points', trueProbability: 63.16, evPercent: 14.54,
      nbaPrediction: { modelVersion: 'NBA_MODEL_V1', validationStatus: 'UNVALIDATED', probabilities: { push: 0.05 },
        fairAmericanOdds: -171, quoteStatus: 'CURRENT', sampleSize: 20, researchContextVersion: '1', intelligenceSnapshotId: 'snapshot-1' } });
    expect(body.ledgerReceipt).toBeNull();
  });
});
