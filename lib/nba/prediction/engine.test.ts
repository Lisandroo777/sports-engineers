import { describe, expect, it } from 'vitest';
import type { NBAObservedGame, NBAProjectionInput } from './types';
import { diagnosticNBAStats, predictNBAMarket } from './engine';

function rows(count = 20, phase: NBAObservedGame['phase'] = 'REGULAR'): NBAObservedGame[] {
  return Array.from({ length: count }, (_, index) => {
    const points = index % 2 === 0 ? 24 : 16;
    const rebounds = index % 2 === 0 ? 4 : 12;
    const assists = index % 2 === 0 ? 8 : 4;
    return { season: 2026, phase, source: 'fixture', log: { gameId: `g${index}`, date: new Date(Date.UTC(2026, 0, index + 1, 18)).toISOString(),
      opponent: 'Opponent', opponentAbbreviation: 'OPP', homeAway: 'home', result: 'W',
      stats: { points, totalRebounds: rebounds, assists, minutes: 30, 'threePointFieldGoalsMade-threePointFieldGoalsAttempted': index % 2 === 0 ? 4 : 2 } } };
  });
}

function input(overrides: Partial<NBAProjectionInput> = {}): NBAProjectionInput {
  return { playerId: 10, teamId: 1, playerName: 'Fixture Player', market: 'points', targetPhase: 'REGULAR', targetSeason: 2026, targetGameId: 'target',
    targetTipoff: '2026-01-21T20:00:00Z', observations: rows(), injury: 'REPORTED_AVAILABLE', line: 20, direction: 'over', americanOdds: -110,
    sportsbook: 'Fixture Book', quoteTimestamp: '2026-01-21T19:30:00Z',
    oppositeQuote: { market: 'points', line: 20, direction: 'under', americanOdds: -110, sportsbook: 'Fixture Book', quoteTimestamp: '2026-01-21T19:30:00Z' }, ...overrides };
}

describe('NBA_MODEL_V1 offline projection engine', () => {
  it('is cutoff-safe for projections, minutes and outlier diagnostics', () => {
    const all = [...rows(20), { ...rows(1)[0], log: { ...rows(1)[0].log, gameId: 'future', date: '2026-01-22T00:00:00Z', stats: { ...rows(1)[0].log.stats, points: 100, minutes: 48 } } }];
    const result = predictNBAMarket(input({ observations: all }));
    expect(result.sampleSize).toBe(20);
    expect(result.minutesSampleSize).toBe(20);
    expect(diagnosticNBAStats(input({ observations: all })).observationGameIds).not.toContain('future');
  });

  it('keeps season phase isolated and reports model probabilities as unvalidated', () => {
    const regular = predictNBAMarket(input({ observations: [...rows(12, 'REGULAR'), ...rows(12, 'POSTSEASON')] }));
    const playoffs = predictNBAMarket(input({ targetPhase: 'POSTSEASON', observations: [...rows(12, 'REGULAR'), ...rows(12, 'POSTSEASON')] }));
    expect(regular.sampleSize).toBe(12);
    expect(playoffs.sampleSize).toBe(12);
    expect(regular.validationStatus).toBe('UNVALIDATED');
  });

  it('uses explicit missing-report and feed-failure states, and fails OUT closed', () => {
    const unavailable = predictNBAMarket(input({ injury: 'FEED_UNAVAILABLE' }));
    const missing = predictNBAMarket(input({ injury: 'REPORT_MISSING' }));
    const out = predictNBAMarket(input({ injury: 'OUT' }));
    expect(unavailable.reasons).toContain('AVAILABILITY_FEED_UNAVAILABLE');
    expect(missing.reasons).toContain('AVAILABILITY_REPORT_MISSING');
    expect(out.expectedStat).toBeNull();
    expect(out.eligibleForReview).toBe(false);
  });

  it('reports no-vig market probability only from a contemporaneous matching opposing quote', () => {
    const paired = predictNBAMarket(input());
    const mismatched = predictNBAMarket(input({ oppositeQuote: { market: 'points', line: 21, direction: 'under', americanOdds: -110,
      sportsbook: 'Fixture Book', quoteTimestamp: '2025-02-01T19:30:00Z' } }));
    expect(paired.noVigMarketProbability).toBeCloseTo(0.5);
    expect(mismatched.noVigMarketProbability).toBeNull();
  });

  it('models combo-market covariance and flags inadequate aligned samples', () => {
    const pra = predictNBAMarket(input({ market: 'pra', line: 34.5 }));
    expect(pra.componentCorrelations).toHaveProperty('points:rebounds');
    const sparse = predictNBAMarket(input({ market: 'pra', observations: rows(4) }));
    expect(sparse.expectedStat).toBeNull();
    expect(sparse.reliability).toBe('UNRELIABLE');
  });

  it('returns null rather than forcing picks from insufficient history', () => {
    const result = predictNBAMarket(input({ observations: rows(4) }));
    expect(result.expectedMinutes).toBeNull();
    expect(result.expectedStat).toBeNull();
    expect(result.probabilities).toBeNull();
    expect(result.eligibleForReview).toBe(false);
  });

  it('labels early-season samples below eight games unreliable and never qualifies them', () => {
    const result = predictNBAMarket(input({ observations: rows(7) }));
    expect(result.sampleSize).toBe(7);
    expect(result.reliability).toBe('UNRELIABLE');
    expect(result.eligibleForReview).toBe(false);
    expect(result.probabilities).toBeNull();
  });

  it('assigns push probability to whole-number points lines', () => {
    const result = predictNBAMarket(input({ line: 20 }));
    expect(result.probabilities).not.toBeNull();
    expect(result.probabilities!.push).toBeGreaterThan(0);
    expect(result.probabilities!.over + result.probabilities!.under + result.probabilities!.push).toBeCloseTo(1);
  });

  it('does not qualify missing, stale, or post-prediction sportsbook quotes', () => {
    const missing = predictNBAMarket(input({ americanOdds: null, oppositeQuote: null }));
    const stale = predictNBAMarket(input({ quoteTimestamp: '2026-01-21T18:00:00Z' }));
    const future = predictNBAMarket(input({ quoteTimestamp: '2026-01-21T21:00:00Z' }));
    expect(missing).toMatchObject({ quoteStatus: 'UNAVAILABLE', expectedValuePercent: null, eligibleForReview: false });
    expect(stale).toMatchObject({ quoteStatus: 'STALE', expectedValuePercent: null, eligibleForReview: false });
    expect(future).toMatchObject({ quoteStatus: 'AFTER_PREDICTION', expectedValuePercent: null, eligibleForReview: false });
  });

  it('does not force a pick when projection clears the line but the saved price EV is non-positive', () => {
    const result = predictNBAMarket(input({ line: 10, direction: 'over', americanOdds: -1000000000,
      oppositeQuote: { market: 'points', line: 10, direction: 'under', americanOdds: 1000000000, sportsbook: 'Fixture Book', quoteTimestamp: '2026-01-21T19:30:00Z' } }));
    expect(result.probabilities).not.toBeNull();
    expect(result.expectedValuePercent).toBeLessThanOrEqual(0);
    expect(result.valueQualified).toBe(false);
    expect(result.eligibleForReview).toBe(false);
  });

  it.each(['points', 'rebounds', 'assists', '3pm', 'pra', 'pr', 'pa', 'ra'] as const)('produces cutoff-scoped distributions for %s', (market) => {
    const result = predictNBAMarket(input({ market, line: market === '3pm' || market === 'rebounds' || market === 'assists' ? 5 : 30.5 }));
    expect(result.sampleSize).toBeGreaterThanOrEqual(8);
    expect(result.expectedStat).not.toBeNull();
    expect(result.probabilities).not.toBeNull();
  });
});
