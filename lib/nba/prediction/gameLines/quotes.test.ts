import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { readCache } = vi.hoisted(() => ({ readCache: vi.fn() }));
vi.mock('../../../odds/persistentCache', () => ({ readPersistentCache: readCache }));
import { loadCachedNBAGameQuotes } from './quotes';
import { assessGameMarket } from './markets';
import { projectNBAGame } from './model';
import { binding, historicalFixture } from './fixtures';

const cacheKey = 'https://api.the-odds-api.com/v4/sports/basketball_nba/events/odds-1/odds?regions=us&markets=h2h,spreads,totals,team_totals&oddsFormat=american';
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-21T18:00:00Z'));
  readCache.mockReset();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden by fixture'); }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('Existing sportsbook cache boundary, zero paid calls', () => {
  it('keeps absent game-line data unsupported and never asks the provider for it', async () => {
    readCache.mockResolvedValue(null);
    const result = await loadCachedNBAGameQuotes({ cacheKey, binding, predictionAt: '2026-01-21T18:00:00Z' });
    expect(result.status).toBe('UNSUPPORTED_QUOTE');
    expect(result.quotes).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('accepts actual cached h2h/spread/total prices and preserves their receipt and book timestamps', async () => {
    readCache.mockResolvedValue({ key: cacheKey, cachedAt: Date.parse('2026-01-21T17:31:00Z'), data: {
      id: 'odds-1', home_team: 'Home', away_team: 'Away', commence_time: '2026-01-21T23:00:00Z',
      bookmakers: [{ key: 'fixture', title: 'Fixture Book', markets: [
        { key: 'h2h', last_update: '2026-01-21T17:30:00Z', outcomes: [{ name: 'Home', price: -120 }, { name: 'Away', price: 100 }] },
        { key: 'spreads', last_update: '2026-01-21T17:30:00Z', outcomes: [{ name: 'Home', price: -110, point: -7.5 }] },
        { key: 'totals', last_update: '2026-01-21T17:30:00Z', outcomes: [{ name: 'Over', price: -110, point: 210.5 }] },
      ] }],
    } });
    const result = await loadCachedNBAGameQuotes({ cacheKey, binding, predictionAt: '2026-01-21T18:00:00Z' });
    expect(result.status).toBe('AVAILABLE');
    expect(result.quotes).toHaveLength(4);
    expect(result.quotes[0]).toMatchObject({ updatedAt: '2026-01-21T17:30:00Z', observedAt: '2026-01-21T17:31:00.000Z' });
    expect(assessGameMarket(projectNBAGame(historicalFixture()), result.quotes[0], binding).status).toBe('PRICED');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('refuses later receipts, player-prop cache keys, wrong events and arbitrary hosts', async () => {
    readCache.mockResolvedValue({ cachedAt: Date.parse('2026-01-21T19:00:00Z'), data: {} });
    expect((await loadCachedNBAGameQuotes({ cacheKey, binding, predictionAt: '2026-01-21T18:00:00Z' })).status).toBe('UNSUPPORTED_QUOTE');
    readCache.mockClear();
    for (const key of [cacheKey.replace('h2h,spreads,totals,team_totals', 'player_points'), cacheKey.replace('api.the-odds-api.com', 'other.example'), `${cacheKey}&apiKey=not-a-real-key`]) {
      expect((await loadCachedNBAGameQuotes({ cacheKey: key, binding, predictionAt: '2026-01-21T18:00:00Z' })).quotes).toEqual([]);
    }
    expect(readCache).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('rejects wrong event request paths before storage access and mismatched stored request receipts', async () => {
    expect((await loadCachedNBAGameQuotes({ cacheKey: cacheKey.replace('odds-1/odds', 'wrong-event/odds'), binding,
      predictionAt: '2026-01-21T18:00:00Z' })).quotes).toEqual([]);
    expect(readCache).not.toHaveBeenCalled();
    readCache.mockResolvedValue({ key: cacheKey.replace('basketball_nba', 'football_nfl'), cachedAt: Date.parse('2026-01-21T17:31:00Z'), data: {} });
    expect((await loadCachedNBAGameQuotes({ cacheKey, binding, predictionAt: '2026-01-21T18:00:00Z' })).reason).toMatch(/Stored request receipt/);
    readCache.mockResolvedValue({ key: cacheKey, cachedAt: Date.parse('2026-01-21T17:31:00Z'), data: { id: binding.eventId, sport_key: 'football_nfl' } });
    expect((await loadCachedNBAGameQuotes({ cacheKey, binding, predictionAt: '2026-01-21T18:00:00Z' })).reason).toMatch(/sport does not match NBA/);
    expect(fetch).not.toHaveBeenCalled();
  });
});