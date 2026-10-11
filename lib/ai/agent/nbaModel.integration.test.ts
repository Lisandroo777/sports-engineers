import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyzePickCandidate } from '../eliteResearchFilter';
import { buildNBAEliteCandidate } from '../../nba/research';
import { predictNBAMarket } from '../../nba/prediction/engine';
import { nbaFinderCandidateToGeneric, selectRankedCandidates } from './tools';
import { buildResearchSessionFromCandidates } from './session';
import { rankCachedSession, toClientResult } from './runner';
import { computeMarketMovement } from '../../finder/marketMovement';
import type { NBACandidate } from '../../finder/nbaEngine';
import type { NBAGameLogEntry } from '../../nba/types';

function playerLogs(): NBAGameLogEntry[] {
  return Array.from({ length: 20 }, (_, index) => ({ gameId: `game-${index}`, date: `2026-01-${String(index + 1).padStart(2, '0')}T18:00:00Z`,
    season: 2026, phase: 'REGULAR', round: null, opponent: 'Opponent', opponentAbbreviation: 'OPP', homeAway: 'home', result: 'W',
    stats: { points: index % 2 ? 22 : 28, minutes: 32, totalRebounds: 7, assists: 5, 'threePointFieldGoalsMade-threePointFieldGoalsAttempted': 3 } }));
}

describe('DeepSide NBA_MODEL_V1 Finder-to-ranked-card integration', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-21T19:30:00Z')); });
  afterEach(() => { vi.useRealTimers(); });

  it('preserves projection, sample count, push-aware price result, and V1 metadata through session, ranking, and response formatting', () => {
    const logs = playerLogs();
    const model = predictNBAMarket({ playerId: 10, teamId: 1, playerName: 'Fixture Player', market: 'points', targetPhase: 'REGULAR', targetSeason: 2026,
      targetGameId: 'target-game', targetTipoff: '2026-01-21T20:00:00Z', observations: logs.map((log) => ({ log, season: 2026, phase: 'REGULAR', source: 'fixture' })),
      injury: 'REPORTED_AVAILABLE', line: 20.5, direction: 'over', americanOdds: -110, sportsbook: 'Fixture Book', quoteTimestamp: '2026-01-21T19:30:00Z',
      oppositeQuote: { market: 'points', line: 20.5, direction: 'under', americanOdds: -110, sportsbook: 'Fixture Book', quoteTimestamp: '2026-01-21T19:30:00Z' } });
    expect(model.expectedStat).not.toBeNull();
    expect(model.probabilities).not.toBeNull();

    const researchCandidate = { candidateId: 'nba-candidate-1', playerId: 10, player: 'Fixture Player', market: 'points' as const,
      line: 20.5, direction: 'over' as const, projection: model.expectedStat, projectionUncertainty: model.statUncertainty, logs,
      matchupAvailable: true, injuryTier: 'ACTIVE' as const, oddsAmerican: -110, lastUpdatedAt: '2026-01-21T19:30:00Z',
      isAlternate: false, marketSupport: 'full' as const, opponentContextAvailable: true };
    const eliteInput = buildNBAEliteCandidate(researchCandidate);
    const analysis = analyzePickCandidate({ ...eliteInput, projection: model.expectedStat, projectionUncertainty: model.statUncertainty,
      sampleSize: model.sampleSize, historicalRates: [model.historyRates.l5, model.historyRates.l10, model.historyRates.l20, model.historyRates.season]
        .map((rate) => rate == null ? null : rate * 100), marketFairProbability: model.noVigMarketProbability,
      nbaProbabilityOverride: { over: model.probabilities!.over, under: model.probabilities!.under, push: model.probabilities!.push,
        expectedValuePercent: model.expectedValuePercent, fairAmericanOdds: model.fairAmericanOdds,
        noVigMarketProbability: model.noVigMarketProbability, eligibleForReview: model.eligibleForReview,
        modelVersion: model.modelVersion, validationStatus: model.validationStatus } });
    const finderCandidate: NBACandidate = {
      sport: 'nba', id: 'nba-candidate-1', eventId: 'target-game', gameId: 'target-game', playerId: 10, playerName: 'Fixture Player',
      playerMatch: 'MATCHED', team: 'Home Team', opponent: 'Away Team', market: 'points', marketLabel: 'Points', historicalSupport: 'full',
      line: 20.5, side: 'over', book: 'Fixture Book', oddsAmerican: -110, isAlternate: false, priceTimestamp: '2026-01-21T19:30:00Z',
      priceFreshness: 'FRESH', history: { supported: true, marketKey: 'points', line: 20.5, side: 'over', windows: {
        l5: { hits: 5, total: 5, rate: 100, mean: 25, median: 25 }, l10: { hits: 10, total: 10, rate: 100, mean: 25, median: 25 },
        l20: { hits: 18, total: 20, rate: 90, mean: 25, median: 25 }, season: { hits: 18, total: 20, rate: 90, mean: 25, median: 25 } } },
      projection: { status: 'OK', projection: model.expectedStat, uncertainty: model.statUncertainty, sampleSize: model.sampleSize,
        reliability: model.reliability, reliabilityReasons: [], method: 'nba_model_v1', inputs: {} },
      injuryTier: 'ACTIVE', injuryEvidence: 'REPORTED_AVAILABLE', outlierDependency: null, alternateLines: null, crossBookThreshold: null,
      marketMovement: computeMarketMovement([]), howItLoses: ['Minutes and role can change.'], position: 'G', opponentContext: null,
      eliteAnalysis: analysis, nbaPrediction: model, researchContext: null, intelligenceSnapshot: null,
    };
    const generic = nbaFinderCandidateToGeneric(finderCandidate);
    const session = buildResearchSessionFromCandidates({ sport: 'nba', date: '2026-01-21', queryIntent: 'Best NBA player props', candidates: [generic],
      toolMeta: { gamesFound: 1, gamesScheduled: 1, propsFound: 1, booksFound: 1, candidatesFound: 1, cached: true, dataFreshnessSeconds: 0, budgetLimited: false } });
    expect(session.candidates[0].sampleSize).toBe(model.sampleSize);
    expect(session.candidates[0].nbaPrediction?.modelVersion).toBe('NBA_MODEL_V1');
    expect(session.candidates[0].pickTier).toBe('ELITE');
    const ranked = selectRankedCandidates(session.candidates, 'Best NBA player props', { sport: 'nba' });
    expect(ranked.selected).toHaveLength(1);
    expect(ranked.selected[0].pickTier).toBe('ELITE');
    const response = toClientResult({ reply: 'Research complete.', toolTrace: [], results: ranked.selected, closestMisses: [],
      meta: { sport: 'nba', date: '2026-01-21', includePasses: false }, researchSessionId: 'session' }, false);
    expect(response.results).toHaveLength(1);
    expect((response.results[0] as typeof ranked.selected[number]).nbaPrediction).toMatchObject({ modelVersion: 'NBA_MODEL_V1', validationStatus: 'UNVALIDATED' });
    expect((response.results[0] as typeof ranked.selected[number]).trueProbability)
      .toBeCloseTo(model.probabilities!.over / (model.probabilities!.over + model.probabilities!.under) * 100, 1);
    expect((response.results[0] as typeof ranked.selected[number]).nbaPrediction?.probabilities?.push).toBe(model.probabilities?.push);
  });

  it('does not substitute player props for a cached moneyline-only request', () => {
    const session = { sport: 'nba', date: '2026-01-21', queryIntent: 'Best NBA player props', generatedAt: '2026-01-21T19:00:00Z',
      toolMeta: { gamesFound: 1, gamesScheduled: 1, propsFound: 1, booksFound: 1, candidatesFound: 1, eliteFound: 1, cached: true,
        dataFreshnessSeconds: 0, budgetLimited: false }, candidates: [] } as unknown as import('./session').ResearchSession;
    const result = rankCachedSession(session, 'Best NBA moneylines', 'session');
    expect(result?.results).toEqual([]);
    expect(result?.reply).toMatch(/moneylines are not currently supported/i);
    expect((result?.meta as Record<string, unknown>)?.unsupportedMarkets).toEqual(['MONEYLINE']);
  });
});
