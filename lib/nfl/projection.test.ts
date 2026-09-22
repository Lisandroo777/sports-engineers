import { describe, expect, it } from 'vitest';
import { buildNFLHistory } from './history';
import { projectNFLMarket } from './projection';
import { getNFLMarketMetadata, getNFLMarketHistoricalValue } from './oddsTypes';
import { NFL_FALLBACK_MARKETS, matchNFLPlayer } from '../finder/nflEngine';
import { normalizeNFLEventProps } from './odds';
import type { NFLGameLogEntry } from './types';

function log(i: number, stats: Record<string, number>): NFLGameLogEntry {
  return {
    gameId: `g${i}`, week: i + 1, date: `2026-09-${String(i + 1).padStart(2, '0')}`,
    opponent: 'Opp', opponentAbbreviation: 'OPP', homeAway: 'home', result: 'W', stats,
  };
}

describe('NFL player matching contract', () => {
  it('returns MATCHED for exactly one exact match', async () => {
    const r = await matchNFLPlayer('Max Scherzer', async () => [{ id: 1, name: 'Max Scherzer' }]);
    expect(r).toEqual({ state: 'MATCHED', playerId: 1, teamId: null, teamName: null, position: null });
  });

  it('returns UNMATCHED for no match', async () => {
    expect(await matchNFLPlayer('Nobody', async () => [])).toEqual({ state: 'UNMATCHED', playerId: null, teamId: null, teamName: null, position: null });
  });

  it('returns AMBIGUOUS for multiple plausible matches without guessing', async () => {
    const r = await matchNFLPlayer('J Williams', async () => [{ id: 1, name: 'James Williams' }, { id: 2, name: 'Jaylen Williams' }]);
    expect(r).toEqual({ state: 'AMBIGUOUS', playerId: null, teamId: null, teamName: null, position: null });
  });
});

describe('NFL market contract', () => {
  it('fallback ingestion covers every reliably researchable common market', () => {
    expect(NFL_FALLBACK_MARKETS).toEqual(expect.arrayContaining([
      'player_pass_yds', 'player_pass_attempts', 'player_pass_completions', 'player_pass_tds', 'player_pass_interceptions',
      'player_rush_yds', 'player_rush_attempts', 'player_rush_longest', 'player_rush_reception_yds',
      'player_reception_yds', 'player_receptions', 'player_reception_longest', 'player_anytime_td',
    ]));
    expect(NFL_FALLBACK_MARKETS).not.toContain('player_field_goals');
    expect(NFL_FALLBACK_MARKETS).not.toContain('player_kicking_points');
  });

  it.each([
    ['player_pass_yds', 'passingYards', 275],
    ['player_rush_yds', 'rushingYards', 42],
    ['player_rush_attempts', 'rushingAttempts', 17],
    ['player_reception_yds', 'receivingYards', 81],
    ['player_receptions', 'receptions', 7],
    ['player_anytime_td', 'rushingTouchdowns', 1],
  ] as const)('maps %s to real ESPN history', (market, stat, value) => {
    const stats = market === 'player_anytime_td' ? { [stat]: value, receivingTouchdowns: 0 } : { [stat]: value };
    expect(getNFLMarketHistoricalValue(market, stats)).toBe(value);
  });

  it('normalizes sportsbook sides and preserves the actual current line and odds', () => {
    const normalized = normalizeNFLEventProps({ id: 'event-1', bookmakers: [{
      key: 'book', title: 'Book', markets: [{ key: 'player_receptions', outcomes: [
        { name: 'Over', description: 'Test Receiver', point: 5.5, price: 120 },
        { name: 'Under', description: 'Test Receiver', point: 5.5, price: -140 },
      ] }],
    }] });
    expect(normalized).toHaveLength(1);
    expect(normalized[0]).toMatchObject({ sport: 'nfl', marketKey: 'player_receptions', line: 5.5, overOdds: 120, underOdds: -140 });
  });

  it('classifies supported markets as full', () => {
    expect(getNFLMarketMetadata('player_pass_yds')?.historicalSupport).toBe('full');
    expect(getNFLMarketMetadata('player_rush_yds')?.historicalSupport).toBe('full');
  });

  it('classifies composite/longest markets as partial', () => {
    expect(getNFLMarketMetadata('player_anytime_td')?.historicalSupport).toBe('partial');
    expect(getNFLMarketMetadata('player_rush_rec_yds')?.historicalSupport).toBe('partial');
  });

  it('classifies unsupported kicking markets as unsupported', () => {
    expect(getNFLMarketMetadata('player_field_goals')?.historicalSupport).toBe('unsupported');
    expect(getNFLMarketHistoricalValue('player_field_goals', { fieldGoalsMade: 3 })).toBeNull();
  });

  it('never converts an unsupported or missing stat into fake zero history', () => {
    expect(getNFLMarketHistoricalValue('player_receptions', {})).toBeNull();
    expect(getNFLMarketHistoricalValue('player_receptions', {})).not.toBe(0);
  });

  it('derives rush+receiving yards only when both components exist', () => {
    expect(getNFLMarketHistoricalValue('player_rush_rec_yds', { rushingYards: 10, receivingYards: 20 })).toBe(30);
    expect(getNFLMarketHistoricalValue('player_rush_rec_yds', { rushingYards: 10 })).toBeNull();
  });

  it('derives anytime TD from rushing+receiving TDs only when both exist', () => {
    expect(getNFLMarketHistoricalValue('player_anytime_td', { rushingTouchdowns: 1, receivingTouchdowns: 0 })).toBe(1);
    expect(getNFLMarketHistoricalValue('player_anytime_td', { rushingTouchdowns: 1 })).toBeNull();
  });
});

describe('NFL exact-line history', () => {
  const logs = [3, 7, 4, 8, 9, 2, 6, 5, 10, 1].map((v, i) => log(i, { receptions: v }));

  it('calculates L3/L5/L10/season exact-line hit windows', () => {
    const h = buildNFLHistory(logs, 'player_receptions', 4.5, 'over');
    expect(h.gamesAvailable).toBe(10);
    expect(h.gamesUsed).toBe(10);
    expect(h.windows.l3.games).toBe(3);
    expect(h.windows.l5.games).toBe(5);
    expect(h.windows.l10.games).toBe(10);
    expect(h.windows.season.hits).toBe(6);
    expect(h.splits.home.games).toBe(10);
    expect(h.splits.home.mean).toBe(5.5);
    expect(h.splits.away.games).toBe(0);
  });

  it('supports under math correctly', () => {
    const h = buildNFLHistory(logs, 'player_receptions', 4.5, 'under');
    expect(h.windows.season.hits).toBe(4);
  });

  it('excludes games with missing stats instead of counting them as zero', () => {
    const h = buildNFLHistory([log(1, { receptions: 3 }), log(2, {}), log(3, { receptions: 7 })], 'player_receptions', 4.5, 'over');
    expect(h.gamesAvailable).toBe(3);
    expect(h.gamesUsed).toBe(2);
    expect(h.mean).toBe(5);
  });

  it('returns unavailable history when no stat is present', () => {
    const h = buildNFLHistory([log(1, {}), log(2, {})], 'player_receptions', 4.5, 'over');
    expect(h.available).toBe(false);
    expect(h.mean).toBeNull();
    expect(h.hitRate).toBeNull();
  });
});

describe('NFL projection foundation', () => {
  it('projects from a real historical baseline and reports uncertainty', () => {
    const p = projectNFLMarket({ logs: [10, 12, 8, 14, 16, 9].map((v, i) => log(i, { receivingYards: v })), market: 'player_reception_yds' });
    expect(p.status).toBe('OK');
    expect(p.projection).not.toBeNull();
    expect(p.uncertainty).not.toBeNull();
    expect(p.method).toBe('nfl_weighted_history');
  });

  it('marks the baseline as role-context limited rather than production-grade', () => {
    const p = projectNFLMarket({ logs: [10, 12, 8, 14, 16, 9].map((v, i) => log(i, { receivingYards: v })), market: 'player_reception_yds' });
    expect(p.reliabilityReasons).toContain('ROLE_CONTEXT_UNAVAILABLE');
    expect(p.reliability).not.toBe('HIGH');
  });

  it('flags a short NFL sample', () => {
    const p = projectNFLMarket({ logs: [10, 12, 8].map((v, i) => log(i, { receivingYards: v })), market: 'player_reception_yds' });
    expect(p.reliabilityReasons).toContain('SHORT_SEASON_SAMPLE');
  });

  it('fails closed when there are too few usable games', () => {
    const p = projectNFLMarket({ logs: [log(1, { receivingYards: 10 }), log(2, {})], market: 'player_reception_yds' });
    expect(p.status).toBe('UNAVAILABLE');
    expect(p.projection).toBeNull();
    expect(p.reliability).toBe('UNRELIABLE');
  });

  it('does not fabricate zero for missing historical stats', () => {
    const p = projectNFLMarket({ logs: [log(1, {}), log(2, {}), log(3, {})], market: 'player_reception_yds' });
    expect(p.projection).toBeNull();
    expect(p.reliabilityReasons).toContain('MISSING_STAT');
  });
});

describe('RARE_COUNT NFL markets use season-only weighting (Phase 6 audit fix)', () => {
  // Real 17-game Vita Vea sack history from the live NFL validation.
  const veaSacks = [0, 0, 0, 2, 0, 0.5, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0];
  const logs = veaSacks.map((v, i) => log(i, { sacks: v }));

  it('projects sacks at the season mean, not the L3-heavy recency blend', () => {
    const p = projectNFLMarket({ logs, market: 'player_sacks' });
    expect(p.status).toBe('OK');
    // Season mean = 0.2647 -> matches, NOT the old L3-heavy blend (~0.12).
    expect(p.projection).toBeCloseTo(0.26, 1);
  });

  it('VOLUME/COUNT markets are unaffected — still use the L3/L5/season blend', () => {
    const volumeLogs = [10, 12, 8, 40, 40, 40].map((v, i) => log(i, { receivingYards: v }));
    const p = projectNFLMarket({ logs: volumeLogs, market: 'player_reception_yds' });
    // L3 mean (last 3) dominates at 0.45 weight -> pulled toward 40, not the full-season mean (~25).
    expect(p.projection).toBeGreaterThan(30);
  });
});
