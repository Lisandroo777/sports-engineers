import { describe, expect, it } from 'vitest';
import {
  mapRawGameLogSplit,
  calculateHits,
  calculateTotalBases,
  calculateHomeRuns,
  calculateRuns,
  calculateRBI,
  calculateHitsRunsRBI,
  calculateStrikeouts,
  calculateOutsRecorded,
} from './stats';

/**
 * Regression tests for the MLB Stats API -> MLBGameLog normalization bug: the real API returns
 * `strikeOuts` (capital O) and `baseOnBalls`, but the code used to read `strikeouts`/`walks`,
 * silently returning 0 for every game (see Andre Pallante showing 0 K across 20 logged games).
 *
 * Fixtures below are REAL raw responses captured from statsapi.mlb.com for Andre Pallante
 * (pitching, id 669467) and Aaron Judge (hitting, id 592450) so this test fails immediately if the
 * field-name mapping regresses, without needing any network call.
 */

const REAL_PITCHING_SPLIT = {
  date: '2026-09-04',
  homeAway: 'away',
  opponent: { name: 'Chicago Cubs' },
  stat: {
    summary: '5.0 IP, ER, K, 4 BB',
    gamesPlayed: 1,
    gamesStarted: 1,
    runs: 1,
    doubles: 0,
    triples: 1,
    homeRuns: 0,
    strikeOuts: 1,
    baseOnBalls: 4,
    hits: 2,
    atBats: 14,
    numberOfPitches: 72,
    inningsPitched: '5.0',
    earnedRuns: 1,
    outs: 15,
    totalBases: 4,
  },
};

const REAL_HITTING_SPLIT = {
  date: '2026-09-08',
  homeAway: 'home',
  opponent: { name: 'Boston Red Sox' },
  stat: {
    gamesPlayed: 1,
    runs: 0,
    doubles: 0,
    triples: 0,
    homeRuns: 0,
    strikeOuts: 2,
    baseOnBalls: 0,
    hits: 0,
    atBats: 3,
    numberOfPitches: 15,
    plateAppearances: 3,
    totalBases: 0,
    rbi: 0,
  },
};

describe('mapRawGameLogSplit (raw MLB API -> normalized MLBGameLog)', () => {
  it('reads the real pitching strikeout field (strikeOuts, capital O), not the wrong "strikeouts" key', () => {
    const log = mapRawGameLogSplit(REAL_PITCHING_SPLIT, 'pitching');
    expect(log.strikeouts).toBe(1);
  });

  it('reads the real walks field (baseOnBalls), not the wrong "walks" key', () => {
    const log = mapRawGameLogSplit(REAL_PITCHING_SPLIT, 'pitching');
    expect(log.walks).toBe(4);
  });

  it('reads the real pitch-count field (numberOfPitches), not the wrong "pitches" key', () => {
    const log = mapRawGameLogSplit(REAL_PITCHING_SPLIT, 'pitching');
    expect(log.pitches).toBe(72);
  });

  it('normalizes the rest of a real pitching game log correctly', () => {
    const log = mapRawGameLogSplit(REAL_PITCHING_SPLIT, 'pitching');
    expect(log.inningsPitched).toBe(5);
    expect(log.hitsAllowed).toBe(2);
    expect(log.earnedRuns).toBe(1);
    expect(log.homeRunsAllowed).toBe(0);
    expect(log.opponent).toBe('Chicago Cubs');
  });

  it('reads the real hitting strikeout field (strikeOuts) for batters too', () => {
    const log = mapRawGameLogSplit(REAL_HITTING_SPLIT, 'hitting');
    expect(log.strikeouts).toBe(2);
  });

  it('reads the real hitting walks field (baseOnBalls) for batters', () => {
    const log = mapRawGameLogSplit(REAL_HITTING_SPLIT, 'hitting');
    expect(log.walks).toBe(0);
  });

  it('distinguishes a genuine zero from a genuinely missing field', () => {
    const missingStrikeouts = mapRawGameLogSplit({ date: '2026-09-08', homeAway: 'home', opponent: { name: 'X' }, stat: { hits: 1 } }, 'hitting');
    expect(missingStrikeouts.strikeouts).toBeNull();

    const zeroStrikeouts = mapRawGameLogSplit({ date: '2026-09-08', homeAway: 'home', opponent: { name: 'X' }, stat: { hits: 1, strikeOuts: 0 } }, 'hitting');
    expect(zeroStrikeouts.strikeouts).toBe(0);
  });
});

describe('calculate* helpers propagate null instead of masking missing data as 0', () => {
  it('calculateStrikeouts returns the real value from a correctly-mapped game log', () => {
    const log = mapRawGameLogSplit(REAL_PITCHING_SPLIT, 'pitching');
    expect(calculateStrikeouts(log)).toBe(1);
  });

  it('calculateStrikeouts returns null when the field was never populated', () => {
    expect(calculateStrikeouts({ date: '', opponent: '', homeAway: '' })).toBeNull();
  });

  it('calculateHits/calculateHomeRuns/calculateRuns/calculateRBI return null when missing', () => {
    const empty = { date: '', opponent: '', homeAway: '' };
    expect(calculateHits(empty)).toBeNull();
    expect(calculateHomeRuns(empty)).toBeNull();
    expect(calculateRuns(empty)).toBeNull();
    expect(calculateRBI(empty)).toBeNull();
  });

  it('calculateTotalBases computes correctly from a real hitting game log', () => {
    const log = mapRawGameLogSplit({ date: '2026-09-08', homeAway: 'home', opponent: { name: 'X' }, stat: { hits: 2, doubles: 1, triples: 0, homeRuns: 1 } }, 'hitting');
    // 2 hits (1 single + 1 double counted separately below) -> total bases = hits + doubles + 2*triples + 3*HR = 2 + 1 + 0 + 3 = 6
    expect(calculateTotalBases(log)).toBe(6);
  });

  it('calculateTotalBases returns null if any component is missing', () => {
    const log = mapRawGameLogSplit({ date: '2026-09-08', homeAway: 'home', opponent: { name: 'X' }, stat: { hits: 2 } }, 'hitting');
    expect(calculateTotalBases(log)).toBeNull();
  });

  it('calculateHitsRunsRBI computes correctly and returns null if any component is missing', () => {
    const complete = mapRawGameLogSplit({ date: '2026-09-08', homeAway: 'home', opponent: { name: 'X' }, stat: { hits: 2, runs: 1, rbi: 3 } }, 'hitting');
    expect(calculateHitsRunsRBI(complete)).toBe(6);
    const incomplete = mapRawGameLogSplit({ date: '2026-09-08', homeAway: 'home', opponent: { name: 'X' }, stat: { hits: 2 } }, 'hitting');
    expect(calculateHitsRunsRBI(incomplete)).toBeNull();
  });

  it('calculateOutsRecorded parses baseball innings notation (X.1 = one extra out, X.2 = two extra outs)', () => {
    expect(calculateOutsRecorded(6)).toBe(18);
    expect(calculateOutsRecorded('6.1')).toBe(19);
    expect(calculateOutsRecorded('6.2')).toBe(20);
    expect(calculateOutsRecorded(null)).toBeNull();
    expect(calculateOutsRecorded(undefined)).toBeNull();
  });
});
