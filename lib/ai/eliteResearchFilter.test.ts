import { describe, expect, it } from 'vitest';
import {
  analyzePickCandidate,
  scoreProjection,
  historicalHitRate,
  classifyPriceFreshness,
  ELITE_THRESHOLDS,
  type EliteCandidateInput,
} from './eliteResearchFilter';
import { modelProbability, calibrateProbability, MAX_HISTORICAL_WEIGHT } from './probabilityModel';

/** A well-formed MLB candidate with complete research data and a fresh, fairly-priced main line. */
function baseCandidate(overrides: Partial<EliteCandidateInput> = {}): EliteCandidateInput {
  return {
    candidateId: 'test-1',
    sport: 'mlb',
    playerId: 12345,
    player: 'Test Player',
    market: 'batter_hits',
    line: 0.5,
    direction: 'over',
    isAlternate: false,
    projection: 1.2,
    projectionUncertainty: 0.6,
    historicalRates: [80, 80, 75, 78],
    sampleSize: 20,
    oddsAmerican: -110,
    marketFairProbability: null,
    matchupAvailable: true,
    usageAvailable: false,
    roleKnown: true,
    gameContextAvailable: true,
    opponentPersonnelAvailable: false,
    marketConfirmationAvailable: true,
    statusKnown: true,
    lastUpdatedAt: new Date().toISOString(),
    requiredMarketSupported: true,
    marketSupport: 'SUPPORTED',
    unsupportedSignals: ['usageOpportunity', 'opponentPersonnel', 'projectionAgreement'],
    ...overrides,
  };
}

describe('unsupported data sources are neutral, never risk (audit fix #2)', () => {
  it('does not add trap risk for usage data DeepSide has never connected', () => {
    const a = analyzePickCandidate(baseCandidate({ usageAvailable: false }));
    expect(a.trapReasons.join(' ')).not.toMatch(/workload|usage/i);
    expect(a.trapComponents.every((c) => !/usage|workload/i.test(c.reason))).toBe(true);
  });

  it('does not add trap risk for opponent personnel DeepSide has never connected', () => {
    const a = analyzePickCandidate(baseCandidate({ opponentPersonnelAvailable: false }));
    expect(a.trapComponents.every((c) => !/personnel/i.test(c.reason))).toBe(true);
  });

  it('allows trap risk to legitimately fall to or below the 25 gate', () => {
    const a = analyzePickCandidate(baseCandidate());
    expect(a.trapRisk).toBeLessThanOrEqual(ELITE_THRESHOLDS.trapRisk);
  });

  it('marks unsupported signals as UNSUPPORTED rather than counting them as unavailable evidence gaps', () => {
    const a = analyzePickCandidate(baseCandidate());
    const usage = a.signals.find((s) => s.key === 'usageOpportunity');
    expect(usage?.availability).toBe('UNSUPPORTED');
    expect(usage?.agrees).toBe(false);
  });
});

describe('missing evidence cannot produce a near-perfect research score (audit fix #3)', () => {
  it('a candidate with NO projection cannot score ~100', () => {
    const a = analyzePickCandidate(baseCandidate({ projection: null, projectionUncertainty: null }));
    expect(a.researchScore).toBeLessThanOrEqual(40);
    expect(a.rejectedReasons).toContain('Projection unavailable');
  });

  it('a candidate with NO history cannot score ~100', () => {
    const a = analyzePickCandidate(baseCandidate({ historicalRates: [], sampleSize: null }));
    expect(a.researchScore).toBeLessThanOrEqual(40);
  });

  it('reports evidence coverage, and less evidence never outscores more evidence', () => {
    const full = analyzePickCandidate(baseCandidate());
    const sparse = analyzePickCandidate(baseCandidate({ matchupAvailable: false, gameContextAvailable: false, marketConfirmationAvailable: false }));
    expect(full.evidenceCoverage).toBeGreaterThan(sparse.evidenceCoverage);
    expect(full.researchScore).toBeGreaterThanOrEqual(sparse.researchScore);
  });
});

describe('signed projection edge (audit fix #4)', () => {
  it('OVER: projection above the line scores above neutral', () => {
    expect(scoreProjection(6 - 4.5, 1)!).toBeGreaterThan(50);
  });
  it('OVER: projection below the line scores below neutral', () => {
    expect(scoreProjection(3 - 4.5, 1)!).toBeLessThan(50);
  });
  it('UNDER: projection below the line scores above neutral', () => {
    expect(scoreProjection(4.5 - 3, 1)!).toBeGreaterThan(50);
  });
  it('UNDER: projection above the line scores below neutral', () => {
    expect(scoreProjection(4.5 - 6, 1)!).toBeLessThan(50);
  });
  it('a wrong-way projection is never rewarded like a right-way one of equal magnitude', () => {
    expect(scoreProjection(-2, 1)!).toBeLessThan(scoreProjection(2, 1)!);
  });

  it('rejects a wrong-way OVER candidate instead of scoring it highly', () => {
    const a = analyzePickCandidate(baseCandidate({ direction: 'over', line: 4.5, projection: 3 }));
    expect(a.rawEdge).toBeLessThan(0);
    expect(a.rejectedReasons).toContain('Projection does not clear the line');
    expect(a.eliteQualified).toBe(false);
  });

  it('rejects a wrong-way UNDER candidate instead of scoring it highly', () => {
    const a = analyzePickCandidate(baseCandidate({ direction: 'under', line: 4.5, projection: 6 }));
    expect(a.rawEdge).toBeLessThan(0);
    expect(a.rejectedReasons).toContain('Projection does not clear the line');
    expect(a.eliteQualified).toBe(false);
  });

  it('rewards a correct UNDER edge', () => {
    const a = analyzePickCandidate(baseCandidate({ direction: 'under', line: 4.5, projection: 3, historicalRates: [80, 80, 75, 78] }));
    expect(a.rawEdge).toBeGreaterThan(0);
    expect(a.rejectedReasons).not.toContain('Projection does not clear the line');
  });
});

describe('signal agreement is reported honestly (audit fix #5)', () => {
  it('reports agreeing/available and never rescales to a fixed denominator of 8', () => {
    const a = analyzePickCandidate(baseCandidate());
    expect(a.signalsAvailable).toBeLessThanOrEqual(a.signals.length);
    expect(a.signalAgreement).toBeLessThanOrEqual(a.signalsAvailable);
    expect(a.agreementRatio).toBeCloseTo(a.signalAgreement / a.signalsAvailable, 5);
  });

  it('three available agreeing signals report 3/3, not 8/8', () => {
    const a = analyzePickCandidate(baseCandidate({
      projection: null, projectionUncertainty: null, historicalRates: [], sampleSize: null,
      oddsAmerican: null, marketConfirmationAvailable: false,
    }));
    expect(a.signalsAvailable).toBe(3);
    expect(a.signalAgreement).toBe(3);
    expect(a.signalAgreement).not.toBe(8);
  });

  it('collapses baseline and recent form into one historical signal (not two independent ones)', () => {
    const a = analyzePickCandidate(baseCandidate());
    expect(a.signals.filter((s) => s.key === 'historicalPerformance')).toHaveLength(1);
    expect(a.signals.some((s) => s.key === 'longTermBaseline')).toBe(false);
    expect(a.signals.some((s) => s.key === 'recentForm')).toBe(false);
  });

  it('requires a minimum number of genuinely available signals to qualify', () => {
    const a = analyzePickCandidate(baseCandidate({
      projection: null, projectionUncertainty: null, historicalRates: [], sampleSize: null,
      oddsAmerican: null, marketConfirmationAvailable: false,
    }));
    expect(a.signalsAvailable).toBeLessThan(ELITE_THRESHOLDS.minSignalsAvailable);
    expect(a.eliteQualified).toBe(false);
  });
});

describe('price freshness is honest and not double-penalised (audit fixes #1, #8)', () => {
  it('classifies freshness into explicit states', () => {
    const now = Date.now();
    expect(classifyPriceFreshness(new Date(now - 60 * 1000).toISOString())).toBe('LIVE');
    expect(classifyPriceFreshness(new Date(now - 30 * 60 * 1000).toISOString())).toBe('FRESH');
    expect(classifyPriceFreshness(new Date(now - 3 * 60 * 60 * 1000).toISOString())).toBe('STALE');
    expect(classifyPriceFreshness(new Date(now - 48 * 60 * 60 * 1000).toISOString())).toBe('EXPIRED');
    expect(classifyPriceFreshness(null)).toBe('UNKNOWN');
  });

  it('a stale price is never silently treated as current', () => {
    const stale = analyzePickCandidate(baseCandidate({ lastUpdatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() }));
    expect(stale.priceFreshness).toBe('STALE');
    expect(stale.priceCurrent).toBe(false);
    expect(stale.eliteQualified).toBe(false);
  });

  it('a stale price does NOT also destroy data quality or inflate trap risk (no triple penalty)', () => {
    const fresh = analyzePickCandidate(baseCandidate());
    const stale = analyzePickCandidate(baseCandidate({ lastUpdatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() }));
    expect(stale.dataQuality).toBe(fresh.dataQuality);
    expect(stale.trapRisk).toBe(fresh.trapRisk);
  });

  it('separates research-qualified from current-price-qualified', () => {
    const stale = analyzePickCandidate(baseCandidate({ lastUpdatedAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() }));
    expect(stale.researchQualified).toBe(true);
    expect(stale.eliteQualified).toBe(false);
  });
});

describe('price discipline and alternate lines (audit fix #6)', () => {
  it('extreme juice does not become Elite on statistical hit probability alone', () => {
    const a = analyzePickCandidate(baseCandidate({ oddsAmerican: -6000, historicalRates: [100, 100, 100, 100] }));
    expect(a.breakEvenProbability!).toBeGreaterThan(90);
    expect(a.evPercent!).toBeLessThan(0);
    expect(a.eliteQualified).toBe(false);
    expect(a.trapReasons.some((r) => /juice/i.test(r))).toBe(true);
  });

  it('recognises alternate lines and excludes them from primary Elite candidacy', () => {
    const a = analyzePickCandidate(baseCandidate({ isAlternate: true }));
    expect(a.isAlternate).toBe(true);
    expect(a.eliteQualified).toBe(false);
    expect(a.rejectedReasons.some((r) => /alternate/i.test(r))).toBe(true);
  });

  it('computes break-even, true probability and EV as distinct quantities', () => {
    const a = analyzePickCandidate(baseCandidate());
    expect(a.breakEvenProbability).not.toBeNull();
    expect(a.trueProbability).not.toBeNull();
    expect(a.evPercent).not.toBeNull();
    expect(a.priceEdgePercent).toBeCloseTo(a.trueProbability! - a.breakEvenProbability!, 0);
  });
});

describe('true probability is modelled, not fabricated (audit fix #7)', () => {
  it('returns null when the sample is too small rather than inventing a number', () => {
    expect(modelProbability({ marketKey: 'batter_hits', line: 0.5, direction: 'over', projection: 1.2, projectionUncertainty: 0.6, sampleSize: 4 })).toBeNull();
  });

  it('returns null for an unmapped market rather than guessing a distribution', () => {
    expect(modelProbability({ marketKey: 'not_a_real_market', line: 0.5, direction: 'over', projection: 1.2, projectionUncertainty: 0.6, sampleSize: 30 })).toBeNull();
  });

  it('historical hit rate alone can never become trueProbability', () => {
    // Rich history but no projection => no model => no probability.
    const a = analyzePickCandidate(baseCandidate({ projection: null, projectionUncertainty: null, historicalRates: [100, 100, 100, 100] }));
    expect(a.historicalHitRatePercent).not.toBeNull();
    expect(a.modelProbability).toBeNull();
    expect(a.trueProbability).toBeNull();
    expect(a.evPercent).toBeNull();
  });

  it('caps historical influence so it supports rather than replaces the model', () => {
    const c = calibrateProbability({ modelProbability: 0.5, historicalHitRate: 1, sampleSize: 100000 });
    expect(c.historicalWeight).toBeLessThanOrEqual(MAX_HISTORICAL_WEIGHT);
    expect(c.calibratedProbability).toBeLessThan(0.5 + MAX_HISTORICAL_WEIGHT * 0.5 + 0.001);
  });

  it('never reports a probability when the candidate has no usable history', () => {
    const a = analyzePickCandidate(baseCandidate({ historicalRates: [], sampleSize: null }));
    expect(a.trueProbability).toBeNull();
    expect(a.evPercent).toBeNull();
    expect(a.eliteQualified).toBe(false);
  });

  it('does not derive probability from researchScore', () => {
    const a = analyzePickCandidate(baseCandidate({ historicalRates: [50, 50, 50, 50] }));
    expect(a.trueProbability).not.toBe(a.researchScore);
  });
});

describe('probability model uses projection, uncertainty, line and direction', () => {
  const m = (o: Partial<Parameters<typeof modelProbability>[0]> = {}) => modelProbability({
    marketKey: 'pitcher_outs', line: 15.5, direction: 'over', projection: 17, projectionUncertainty: 3, sampleSize: 25, ...o,
  });

  it('uses the projection: a higher projection raises OVER probability', () => {
    expect(m({ projection: 19 })!.probability).toBeGreaterThan(m({ projection: 16 })!.probability);
  });

  it('uses the line: a higher line lowers OVER probability', () => {
    expect(m({ line: 20.5 })!.probability).toBeLessThan(m({ line: 12.5 })!.probability);
  });

  it('respects direction: OVER and UNDER are complements', () => {
    expect(m({ direction: 'over' })!.probability + m({ direction: 'under' })!.probability).toBeCloseTo(1, 5);
  });

  it('larger uncertainty pulls probability toward 50%', () => {
    const tight = m({ projectionUncertainty: 1 })!.probability;
    const wide = m({ projectionUncertainty: 8 })!.probability;
    expect(Math.abs(wide - 0.5)).toBeLessThan(Math.abs(tight - 0.5));
  });

  it('a projection further past the line moves probability further from 50%', () => {
    const near = m({ projection: 16 })!.probability;
    const far = m({ projection: 22 })!.probability;
    expect(Math.abs(far - 0.5)).toBeGreaterThan(Math.abs(near - 0.5));
  });

  it('a wrong-way projection produces a probability below 50%', () => {
    expect(m({ direction: 'over', projection: 12 })!.probability).toBeLessThan(0.5);
    expect(m({ direction: 'under', projection: 19 })!.probability).toBeLessThan(0.5);
  });

  it('a strong OVER projection produces OVER probability above 50%', () => {
    expect(m({ direction: 'over', projection: 20 })!.probability).toBeGreaterThan(0.5);
  });

  it('a strong UNDER projection produces UNDER probability above 50%', () => {
    expect(m({ direction: 'under', projection: 11 })!.probability).toBeGreaterThan(0.5);
  });

  it('requires a spread estimate for VOLUME markets and fails closed without one', () => {
    expect(m({ projectionUncertainty: null })).toBeNull();
  });

  it('models rare-event markets with Poisson and refuses absurd confidence without evidence', () => {
    const hr = modelProbability({ marketKey: 'batter_home_runs', line: 0.5, direction: 'over', projection: 0.3, projectionUncertainty: 0.5, sampleSize: 25 })!;
    expect(hr.distribution).toBe('poisson');
    expect(hr.probability).toBeLessThan(0.4);
  });

  it('uses negative binomial for overdispersed count markets', () => {
    const nb = modelProbability({ marketKey: 'batter_total_bases', line: 1.5, direction: 'over', projection: 1.2, projectionUncertainty: 1.6, sampleSize: 25 })!;
    expect(nb.distribution).toBe('negative_binomial');
  });

  it('small samples never produce a probability at all', () => {
    for (const n of [0, 1, 5, 9]) expect(m({ sampleSize: n })).toBeNull();
  });

  it('bounds confidence by sample size so a small sample cannot assert near-certainty', () => {
    // Projection far past the line would otherwise return ~99.9%.
    const small = modelProbability({ marketKey: 'batter_doubles', line: 0.5, direction: 'under', projection: 0, projectionUncertainty: 0.25, sampleSize: 10 })!;
    const large = modelProbability({ marketKey: 'batter_doubles', line: 0.5, direction: 'under', projection: 0, projectionUncertainty: 0.25, sampleSize: 60 })!;
    expect(small.probability).toBeLessThanOrEqual(1 - 1 / 12 + 1e-9);
    expect(small.probability).toBeLessThan(large.probability);
    expect(large.probability).toBeLessThan(0.99);
  });
});

describe('stale prices suppress current value entirely (audit fix #9)', () => {
  const staleAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();

  it('current price edge is null when the price is stale', () => {
    expect(analyzePickCandidate(baseCandidate({ lastUpdatedAt: staleAt })).priceEdgePercent).toBeNull();
  });

  it('current EV is null when the price is stale', () => {
    expect(analyzePickCandidate(baseCandidate({ lastUpdatedAt: staleAt })).evPercent).toBeNull();
  });

  it('EV is null for EXPIRED and UNKNOWN prices too', () => {
    expect(analyzePickCandidate(baseCandidate({ lastUpdatedAt: new Date(Date.now() - 48 * 3600_000).toISOString() })).evPercent).toBeNull();
    expect(analyzePickCandidate(baseCandidate({ lastUpdatedAt: null })).evPercent).toBeNull();
  });

  it('still reports the historical line/price and lets research run', () => {
    const a = analyzePickCandidate(baseCandidate({ lastUpdatedAt: staleAt }));
    expect(a.breakEvenProbability).not.toBeNull();
    expect(a.trueProbability).not.toBeNull();
    expect(a.researchScore).toBeGreaterThan(0);
    expect(a.eliteQualified).toBe(false);
  });
});

describe('a legitimately strong, fresh, fairly-priced candidate can still qualify', () => {
  it('does not make Elite mathematically impossible', () => {
    const a = analyzePickCandidate(baseCandidate({ oddsAmerican: 120, historicalRates: [85, 85, 80, 82], sampleSize: 25 }));
    expect(a.trapRisk).toBeLessThanOrEqual(ELITE_THRESHOLDS.trapRisk);
    expect(a.dataQuality).toBeGreaterThanOrEqual(ELITE_THRESHOLDS.dataQuality);
    expect(a.priceCurrent).toBe(true);
    expect(a.evPercent!).toBeGreaterThan(0);
    expect(a.eliteQualified).toBe(true);
  });
});

describe('priceCurrent and valueQualified are independent (audit fix #11)', () => {
  it('a stale price can still be valueQualified — the value claim just cannot be asserted as current', () => {
    const staleAt = new Date(Date.now() - 8 * 3600_000).toISOString();
    const a = analyzePickCandidate(baseCandidate({ oddsAmerican: 120, historicalRates: [85, 85, 80, 82], sampleSize: 25, lastUpdatedAt: staleAt }));
    expect(a.priceCurrent).toBe(false);
    // trueProbability/breakEven/EV are computed from the stale price's own odds, so value can still
    // be assessed even though it cannot be asserted as CURRENT.
    expect(a.trueProbability).not.toBeNull();
    expect(a.valueQualified).toBe(true);
    expect(a.eliteQualified).toBe(false);
  });

  it('a fresh price with no valid probability is priceCurrent but not valueQualified', () => {
    const a = analyzePickCandidate(baseCandidate({ projection: null }));
    expect(a.priceCurrent).toBe(true);
    expect(a.valueQualified).toBe(false);
    expect(a.eliteQualified).toBe(false);
  });

  it('negative EV at a fresh price is priceCurrent but not valueQualified', () => {
    const a = analyzePickCandidate(baseCandidate({ oddsAmerican: -400 }));
    expect(a.priceCurrent).toBe(true);
    expect(a.valueQualified).toBe(false);
  });

  it('eliteQualified requires BOTH priceCurrent and valueQualified', () => {
    const a = analyzePickCandidate(baseCandidate({ oddsAmerican: 120, historicalRates: [85, 85, 80, 82], sampleSize: 25 }));
    expect(a.priceCurrent && a.valueQualified).toBe(true);
    expect(a.eliteQualified).toBe(true);
  });
});

/**
 * Research Score / Signal Agreement reachability audit (Phase 2 task #10).
 *
 * MLB's threshold was previously found to be structurally unreachable for months before being
 * caught. These tests prove — empirically, not just by inspection — that researchScore>=85 and
 * agreementRatio>=0.75 are BOTH mathematically reachable for NFL and NBA's currently-supported
 * evidence, given a strong idealized candidate. They do NOT lower ELITE_THRESHOLDS.researchScore;
 * they only prove 85 is not an unreachable ceiling for these sports as currently wired.
 */
describe('Research Score / Signal Agreement reachability audit — NFL', () => {
  it('an idealized NFL candidate (best currently-supported evidence) can reach Elite', () => {
    // NFL's real limitations: no snap share/routes/targets/depth chart, so roleKnown=false and
    // usageAvailable=false always (see lib/nfl/research.ts). opponentPersonnel and
    // projectionAgreement are declared unsupported. Everything else uses a strong, realistic value.
    const a = analyzePickCandidate({
      candidateId: 'nfl-ideal', sport: 'nfl', playerId: 1, player: 'Ideal QB',
      market: 'player_pass_yds', line: 240, direction: 'over',
      isAlternate: false, projection: 300, projectionUncertainty: 25,
      historicalRates: [90, 85, 88, 87], sampleSize: 16,
      oddsAmerican: 115, marketFairProbability: null,
      matchupAvailable: true, usageAvailable: false, roleKnown: false,
      gameContextAvailable: true, opponentPersonnelAvailable: false, marketConfirmationAvailable: true,
      statusKnown: true, lastUpdatedAt: new Date().toISOString(),
      requiredMarketSupported: true, marketSupport: 'SUPPORTED',
      unsupportedSignals: ['usageOpportunity', 'opponentPersonnel', 'projectionAgreement'],
    });
    expect(a.researchScore).toBeGreaterThanOrEqual(ELITE_THRESHOLDS.researchScore);
    expect(a.agreementRatio ?? 0).toBeGreaterThanOrEqual(ELITE_THRESHOLDS.minAgreementRatio);
    expect(a.signalsAvailable).toBeGreaterThanOrEqual(ELITE_THRESHOLDS.minSignalsAvailable);
    expect(a.eliteQualified).toBe(true);
  });
});

describe('Research Score / Signal Agreement reachability audit — NBA', () => {
  it('an idealized NBA candidate (best currently-supported evidence) can reach Elite', () => {
    // NBA has real usage evidence (expected minutes from the projection engine) and a known injury
    // status, unlike NFL. opponentPersonnel and projectionAgreement stay unsupported (see
    // lib/nba/research.ts).
    const a = analyzePickCandidate({
      candidateId: 'nba-ideal', sport: 'nba', playerId: 2, player: 'Ideal Wing',
      market: 'points', line: 20, direction: 'over',
      isAlternate: false, projection: 26, projectionUncertainty: 3.5,
      historicalRates: [88, 90, 85, 86], sampleSize: 18,
      oddsAmerican: 110, marketFairProbability: null,
      matchupAvailable: true, usageAvailable: true, roleKnown: true,
      gameContextAvailable: true, opponentPersonnelAvailable: false, marketConfirmationAvailable: true,
      statusKnown: true, lastUpdatedAt: new Date().toISOString(),
      requiredMarketSupported: true, marketSupport: 'SUPPORTED',
      unsupportedSignals: ['projectionAgreement', 'opponentPersonnel'],
    });
    expect(a.researchScore).toBeGreaterThanOrEqual(ELITE_THRESHOLDS.researchScore);
    expect(a.agreementRatio ?? 0).toBeGreaterThanOrEqual(ELITE_THRESHOLDS.minAgreementRatio);
    expect(a.signalsAvailable).toBeGreaterThanOrEqual(ELITE_THRESHOLDS.minSignalsAvailable);
    expect(a.eliteQualified).toBe(true);
  });
});

describe('probability is independent of sportsbook price (Phase 6 task 10)', () => {
  it('changing American odds changes EV/breakeven but never modelProbability or trueProbability', () => {
    const cheap = analyzePickCandidate(baseCandidate({ oddsAmerican: -400 }));
    const juicy = analyzePickCandidate(baseCandidate({ oddsAmerican: 300 }));
    expect(cheap.modelProbability).toBe(juicy.modelProbability);
    expect(cheap.trueProbability).toBe(juicy.trueProbability);
    // But breakeven/EV DO depend on price, as expected.
    expect(cheap.breakEvenProbability).not.toBe(juicy.breakEvenProbability);
  });
});

describe('Vita Vea sack case (Phase 6 rare-event audit regression)', () => {
  // Real 17-game history pulled from the live NFL validation: [0,0,0,2,0,0.5,0,0,0,0,0,1,1,0,0,0,0].
  // Season mean = 0.2647, sample stdDev = 0.562. Season-weighted Poisson P(0 sacks) ≈ 76.7%, matching
  // the empirical UNDER-0.5 rate (76.5%) far more closely than the old L3-heavy recency projection
  // (which produced an inflated 88.7% from 3 recent zero-sack games alone).
  it('at the real season-mean projection, model probability lands near the empirical rate, not near-certainty', () => {
    const a = analyzePickCandidate(baseCandidate({
      sport: 'nfl', market: 'player_sacks', line: 0.5, direction: 'under',
      projection: 0.26, projectionUncertainty: 0.56, sampleSize: 17,
      historicalRates: [100, 80, 80, 76.5],
    }));
    expect(a.modelProbability).not.toBeNull();
    expect(a.modelProbability!).toBeGreaterThan(65);
    expect(a.modelProbability!).toBeLessThan(85);
  });
});
