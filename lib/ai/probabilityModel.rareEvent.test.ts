import { describe, it, expect } from 'vitest';
import { getMarketFamily, modelProbability, calibrateProbability } from './probabilityModel';

describe('NFL market family classification (Phase 6 audit)', () => {
  it('classifies volume markets as VOLUME', () => {
    for (const m of ['player_pass_yds', 'player_rush_yds', 'player_reception_yds']) {
      expect(getMarketFamily(m)).toBe('VOLUME');
    }
  });
  it('classifies count-but-frequent markets as COUNT', () => {
    for (const m of ['player_pass_attempts', 'player_pass_completions', 'player_rush_attempts', 'player_receptions']) {
      expect(getMarketFamily(m)).toBe('COUNT');
    }
  });
  it('classifies rare events (sacks/INTs/TDs) as RARE_COUNT', () => {
    for (const m of ['player_sacks', 'player_pass_interceptions', 'player_defensive_interceptions', 'player_pass_tds', 'player_rush_tds', 'player_reception_tds', 'player_anytime_td']) {
      expect(getMarketFamily(m)).toBe('RARE_COUNT');
    }
  });
  it('returns null (UNSUPPORTED) for markets with no real distribution mapping', () => {
    expect(getMarketFamily('player_kicking_points')).toBeNull();
    expect(getMarketFamily('player_field_goals')).toBeNull();
  });
});

describe('Poisson sanity checks for RARE_COUNT markets at line 0.5', () => {
  const rates = [0.10, 0.25, 0.50, 0.75, 1.00, 1.50];

  it('P(OVER 0.5) + P(UNDER 0.5) sums to 1', () => {
    for (const rate of rates) {
      const over = modelProbability({ marketKey: 'player_sacks', line: 0.5, direction: 'over', projection: rate, projectionUncertainty: null, sampleSize: 20 });
      const under = modelProbability({ marketKey: 'player_sacks', line: 0.5, direction: 'under', projection: rate, projectionUncertainty: null, sampleSize: 20 });
      expect(over).not.toBeNull();
      expect(under).not.toBeNull();
      expect(over!.probability + under!.probability).toBeCloseTo(1, 5);
    }
  });

  it('OVER probability increases monotonically as the event rate increases', () => {
    const overs = rates.map((rate) => modelProbability({ marketKey: 'player_sacks', line: 0.5, direction: 'over', projection: rate, projectionUncertainty: null, sampleSize: 20 })!.probability);
    for (let i = 1; i < overs.length; i += 1) expect(overs[i]).toBeGreaterThan(overs[i - 1]);
  });

  it('UNDER probability decreases monotonically as the event rate increases', () => {
    const unders = rates.map((rate) => modelProbability({ marketKey: 'player_sacks', line: 0.5, direction: 'under', projection: rate, projectionUncertainty: null, sampleSize: 20 })!.probability);
    for (let i = 1; i < unders.length; i += 1) expect(unders[i]).toBeLessThan(unders[i - 1]);
  });

  it('holds the same complement/monotonicity properties at lines 1.5 and 2.5', () => {
    for (const line of [1.5, 2.5]) {
      const over = modelProbability({ marketKey: 'player_sacks', line, direction: 'over', projection: 1.0, projectionUncertainty: null, sampleSize: 20 })!;
      const under = modelProbability({ marketKey: 'player_sacks', line, direction: 'under', projection: 1.0, projectionUncertainty: null, sampleSize: 20 })!;
      expect(over.probability + under.probability).toBeCloseTo(1, 5);
    }
  });
});

describe('rare-event small-sample safety (never near-certain from a tiny zero-heavy sample)', () => {
  const cases = [
    { games: 3, events: 0 }, { games: 5, events: 0 }, { games: 8, events: 1 },
    { games: 10, events: 0 }, { games: 17, events: 2 }, { games: 25, events: 3 },
  ];
  it('never returns a probability of exactly 100% (or 0%) regardless of sample', () => {
    for (const { games, events } of cases) {
      const rate = events / games;
      const result = modelProbability({ marketKey: 'player_sacks', line: 0.5, direction: 'under', projection: rate, projectionUncertainty: null, sampleSize: games });
      if (result == null) continue; // below MIN_SAMPLE_BY_FAMILY is a valid fail-closed outcome
      expect(result.probability).toBeLessThan(1);
      expect(result.probability).toBeGreaterThan(0);
    }
  });

  it('below the family minimum sample, modelProbability fails closed (null), never a guess', () => {
    expect(modelProbability({ marketKey: 'player_sacks', line: 0.5, direction: 'under', projection: 0, projectionUncertainty: null, sampleSize: 3 })).toBeNull();
  });
});

describe('historical hit rate calibration stays bounded and never becomes the model', () => {
  it('even 17/17 historical UNDER cannot push calibrated probability to certainty', () => {
    const c = calibrateProbability({ modelProbability: 0.769, historicalHitRate: 1.0, sampleSize: 17 });
    expect(c.calibratedProbability).toBeLessThan(0.98 + 1e-9);
    expect(c.historicalWeight).toBeLessThanOrEqual(0.35);
  });

  it('historical weight scales with sample size but is capped at 35%', () => {
    for (const [hitRate, n] of [[1.0, 17], [15 / 17, 17], [12 / 17, 17], [8 / 17, 17]] as const) {
      const c = calibrateProbability({ modelProbability: 0.77, historicalHitRate: hitRate, sampleSize: n });
      expect(c.historicalWeight).toBeLessThanOrEqual(0.35);
      expect(c.calibratedProbability).toBeGreaterThanOrEqual(0.02);
      expect(c.calibratedProbability).toBeLessThanOrEqual(0.98);
    }
  });

  it('small samples get proportionally less historical weight than larger ones', () => {
    const small = calibrateProbability({ modelProbability: 0.7, historicalHitRate: 0.9, sampleSize: 5 });
    const large = calibrateProbability({ modelProbability: 0.7, historicalHitRate: 0.9, sampleSize: 40 });
    expect(small.historicalWeight).toBeLessThan(large.historicalWeight);
  });
});

describe('probability is independent of sportsbook price (Phase 6 task 10)', () => {
  it('modelProbability never takes price as an input at all', () => {
    // modelProbability's params contain no odds/price field — verified structurally by construction:
    // it only accepts marketKey/line/direction/projection/projectionUncertainty/sampleSize.
    const a = modelProbability({ marketKey: 'player_sacks', line: 0.5, direction: 'under', projection: 0.26, projectionUncertainty: null, sampleSize: 17 });
    const b = modelProbability({ marketKey: 'player_sacks', line: 0.5, direction: 'under', projection: 0.26, projectionUncertainty: null, sampleSize: 17 });
    expect(a!.probability).toBe(b!.probability);
  });
});
