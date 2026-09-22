import { describe, expect, it } from 'vitest';
import { getStatForCanonicalMarket } from './signals';
import type { MLBGameLog } from '../mlb/types';

const EMPTY: MLBGameLog = { date: '2026-09-08', opponent: 'X', homeAway: 'home' };

describe('getStatForCanonicalMarket propagates null instead of a masked 0', () => {
  it('pitcher_strikeouts / batter_strikeouts return the real value, not 0, for a populated game', () => {
    const game: MLBGameLog = { ...EMPTY, strikeouts: 7 };
    expect(getStatForCanonicalMarket(game, 'pitcher_strikeouts')).toBe(7);
    expect(getStatForCanonicalMarket(game, 'batter_strikeouts')).toBe(7);
  });

  it('returns null (not 0) for every supported market when the field is genuinely missing', () => {
    expect(getStatForCanonicalMarket(EMPTY, 'batter_hits')).toBeNull();
    expect(getStatForCanonicalMarket(EMPTY, 'batter_total_bases')).toBeNull();
    expect(getStatForCanonicalMarket(EMPTY, 'batter_home_runs')).toBeNull();
    expect(getStatForCanonicalMarket(EMPTY, 'batter_runs_scored')).toBeNull();
    expect(getStatForCanonicalMarket(EMPTY, 'batter_rbis')).toBeNull();
    expect(getStatForCanonicalMarket(EMPTY, 'batter_hits_runs_rbis')).toBeNull();
    expect(getStatForCanonicalMarket(EMPTY, 'batter_strikeouts')).toBeNull();
    expect(getStatForCanonicalMarket(EMPTY, 'batter_doubles')).toBeNull();
    expect(getStatForCanonicalMarket(EMPTY, 'batter_triples')).toBeNull();
    expect(getStatForCanonicalMarket(EMPTY, 'batter_walks')).toBeNull();
    expect(getStatForCanonicalMarket(EMPTY, 'pitcher_strikeouts')).toBeNull();
    expect(getStatForCanonicalMarket(EMPTY, 'pitcher_hits_allowed')).toBeNull();
    expect(getStatForCanonicalMarket(EMPTY, 'pitcher_earned_runs')).toBeNull();
    expect(getStatForCanonicalMarket(EMPTY, 'pitcher_outs')).toBeNull();
  });

  it('distinguishes a genuine zero from a missing field for doubles/triples/walks/hitsAllowed/earnedRuns', () => {
    const zeroed: MLBGameLog = { ...EMPTY, doubles: 0, triples: 0, walks: 0, hitsAllowed: 0, earnedRuns: 0 };
    expect(getStatForCanonicalMarket(zeroed, 'batter_doubles')).toBe(0);
    expect(getStatForCanonicalMarket(zeroed, 'batter_triples')).toBe(0);
    expect(getStatForCanonicalMarket(zeroed, 'batter_walks')).toBe(0);
    expect(getStatForCanonicalMarket(zeroed, 'pitcher_hits_allowed')).toBe(0);
    expect(getStatForCanonicalMarket(zeroed, 'pitcher_earned_runs')).toBe(0);
  });

  it('returns null for an unsupported market key', () => {
    expect(getStatForCanonicalMarket({ ...EMPTY, hits: 3 }, 'not_a_real_market')).toBeNull();
  });
});
