import { describe, it, expect } from 'vitest';
import { computeAlternateLineOptimizer } from './alternateLineOptimizer';
import { computeCrossBookThreshold } from './crossBookThreshold';
import { computeMarketMovement } from './marketMovement';
import { buildEvidenceBoard } from './evidenceBoard';
import type { NormalizedProp } from '../odds/types';

function prop(overrides: Partial<NormalizedProp> = {}): NormalizedProp {
  return {
    sport: 'nba', player: 'Test Player', playerId: 1, marketKey: 'points', sourceMarketKey: 'player_points',
    isAlternate: false, historicalAnalysisAvailable: true, marketLabel: 'Points', line: 20,
    overOdds: -110, underOdds: -110, sportsbookKey: 'book_a', sportsbookName: 'Book A',
    eventId: 'evt1', lastUpdate: new Date().toISOString(),
    ...overrides,
  };
}

describe('alternate-line optimizer reused for NBA/NFL (never fabricates thresholds)', () => {
  it('only surfaces REAL posted thresholds from the provided props, never invented ones', () => {
    const props = [
      prop({ line: 20, sportsbookKey: 'book_a', sportsbookName: 'Book A' }),
      prop({ line: 22.5, isAlternate: true, sportsbookKey: 'book_a', sportsbookName: 'Book A' }),
      prop({ line: 17.5, isAlternate: true, sportsbookKey: 'book_b', sportsbookName: 'Book B' }),
    ];
    const result = computeAlternateLineOptimizer(props, 'Test Player', 'points', 'over');
    expect(result.available).toBe(true);
    expect(result.options.map((o) => o.line).sort((a, b) => a - b)).toEqual([17.5, 20, 22.5]);
  });

  it('is unavailable (not fabricated) when there is no matching prop at all', () => {
    const result = computeAlternateLineOptimizer([], 'Nobody', 'points', 'over');
    expect(result.available).toBe(false);
    expect(result.options).toEqual([]);
  });

  it('works identically for NFL props (sport-agnostic function)', () => {
    const props = [
      prop({ sport: 'nfl', marketKey: 'player_pass_yds', line: 250 }),
      prop({ sport: 'nfl', marketKey: 'player_pass_yds', line: 275, isAlternate: true }),
    ];
    const result = computeAlternateLineOptimizer(props, 'Test Player', 'player_pass_yds', 'over');
    expect(result.available).toBe(true);
    expect(result.options).toHaveLength(2);
  });
});

describe('cross-book threshold disagreement generalized to MLB/NFL/NBA', () => {
  it('flags disagreement when books post different standard lines for the same player+market', () => {
    const props = [
      prop({ line: 20, sportsbookKey: 'book_a', sportsbookName: 'Book A' }),
      prop({ line: 20.5, sportsbookKey: 'book_b', sportsbookName: 'Book B' }),
    ];
    const result = computeCrossBookThreshold(props, 'Test Player', 'points');
    expect(result.available).toBe(true);
    expect(result.discrepancy).toBe(true);
    expect(result.spread).toBeCloseTo(0.5, 5);
  });

  it('reports no discrepancy when all books agree', () => {
    const props = [
      prop({ line: 20, sportsbookKey: 'book_a' }),
      prop({ line: 20, sportsbookKey: 'book_b' }),
    ];
    const result = computeCrossBookThreshold(props, 'Test Player', 'points');
    expect(result.discrepancy).toBe(false);
  });

  it('is unavailable when there is no standard-line prop for this player+market', () => {
    const result = computeCrossBookThreshold([], 'Nobody', 'points');
    expect(result.available).toBe(false);
  });
});

describe('market movement (audited): unavailable without real timestamped snapshots', () => {
  it('reports UNAVAILABLE rather than inferring movement from a single observation', () => {
    const single = computeMarketMovement([{ odds: -110, timestamp: Date.now() }]);
    expect(single.available).toBe(false);
    expect(single.direction).toBe('unavailable');
  });

  it('reports UNAVAILABLE with zero snapshots (NFL/NBA today, since neither engine records snapshots)', () => {
    const none = computeMarketMovement([]);
    expect(none.available).toBe(false);
  });

  it('can compute real movement once 2+ real snapshots exist', () => {
    const history = [{ odds: 120, timestamp: Date.now() - 60_000 }, { odds: -110, timestamp: Date.now() }];
    const movement = computeMarketMovement(history);
    expect(movement.available).toBe(true);
    expect(movement.direction).toBe('shortened');
  });
});

describe('evidence board agreement denominator (never fake N/N)', () => {
  it('only AVAILABLE signals enter the implicit agreement denominator — unavailable signals are excluded from agree/disagree counts', () => {
    const board = buildEvidenceBoard({
      side: 'over', rawEdge: 2, l10Rate: 60, seasonRate: null,
      matchupAvailable: true, roleKnown: false, sport: 'nfl',
    });
    const available = board.filter((e) => e.status !== 'unavailable');
    const unavailable = board.filter((e) => e.status === 'unavailable');
    // Expected Role, Long-Term Baseline, Injury Cascade, Film/Scouting, Trench Matchup, Game
    // Script, Opportunity, Outlier Dependence, Price Value, Cross-Book, Market Movement all stay
    // unavailable here since none of the optional evidence was supplied — never displayed as agree.
    expect(unavailable.length).toBeGreaterThan(0);
    expect(available.every((e) => e.status === 'agree' || e.status === 'disagree')).toBe(true);
    // Never a fake full board: total signals != count of "agree" unless every source is real.
    expect(board.filter((e) => e.status === 'agree').length).toBeLessThan(board.length);
  });

  it('does not duplicate the same fact as two different signals when only one source exists', () => {
    const board = buildEvidenceBoard({
      side: 'over', rawEdge: 1, l10Rate: 70, seasonRate: 65,
      matchupAvailable: true, roleKnown: true, sport: 'nba',
      outlierDependencePercent: 20, priceValueAvailable: true, priceValueDetail: '5% EV',
      crossBookDiscrepancy: false, marketMovementAvailable: false,
    });
    const signalNames = board.map((e) => e.signal);
    expect(new Set(signalNames).size).toBe(signalNames.length);
  });
});
