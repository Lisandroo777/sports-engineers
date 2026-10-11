import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { readCache } = vi.hoisted(() => ({ readCache: vi.fn() }));
vi.mock('../../odds/persistentCache', () => ({ readPersistentCache: readCache }));

import { loadCachedNBAPlayerProps } from './cachedProps';

const eventId = 'odds-1';
const base = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${eventId}`;
const discoveryKey = `${base}/markets?regions=us`;
const pricesKey = `${base}/odds?regions=us&markets=player_points&oddsFormat=american`;
const updatedAt = '2026-01-21T17:30:00Z';
const receivedAt = Date.parse('2026-01-21T17:31:00Z');

function discovery() {
  return { cachedAt: receivedAt, data: { bookmakers: [
    { markets: [{ key: 'h2h' }, { key: 'player_points' }] },
    { markets: [{ key: 'player_points' }] },
  ] } };
}

function prices(cachedAt = receivedAt) {
  return { cachedAt, data: { id: eventId, bookmakers: [{ key: 'draftkings', title: 'DraftKings', markets: [{
    key: 'player_points', last_update: updatedAt, outcomes: [
      { name: 'Over', description: 'Test Player', point: 20.5, price: -115 },
      { name: 'Under', description: 'Test Player', point: 25.5, price: -125 },
      { name: 'Over', description: 'Test Player', point: 25.5, price: 105 },
      { name: 'Under', description: 'Test Player', point: 20.5, price: -105 },
      { name: 'Over', description: 'Test Player', point: 30.5, price: 150 },
      { name: 'Under', description: 'Test Player', point: 35.5, price: -200 },
    ],
  }] }] } };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-21T18:00:00Z'));
  readCache.mockReset();
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden by fixture'); }));
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Cached NBA player props, zero network calls', () => {
  it('pairs each exact line separately and never combines mismatched over/under lines', async () => {
    readCache.mockImplementation(async (key: string) => key === discoveryKey ? discovery() : key === pricesKey ? prices() : null);

    const result = await loadCachedNBAPlayerProps(eventId);

    expect(result).toEqual([
      { line: 20.5, overOdds: -115, underOdds: -105 },
      { line: 25.5, overOdds: 105, underOdds: -125 },
      { line: 30.5, overOdds: 150, underOdds: null },
      { line: 35.5, overOdds: null, underOdds: -200 },
    ].map(selection => ({ ...selection, player: 'Test Player', marketKey: 'points', sourceMarketKey: 'player_points',
      isAlternate: false, historicalAnalysisAvailable: true, marketLabel: 'Points', sportsbookKey: 'draftkings',
      sportsbookName: 'DraftKings', eventId, lastUpdate: updatedAt })));
    expect(readCache.mock.calls).toEqual([[discoveryKey], [pricesKey]]);
  });

  it.each([
    ['missing discovery', null],
    ['empty discovery', { cachedAt: receivedAt, data: {} }],
    ['no player markets', { cachedAt: receivedAt, data: { bookmakers: [{ markets: [{ key: 'h2h' }] }] } }],
  ])('returns no props with %s and never fetches missing data', async (_label, entry) => {
    readCache.mockResolvedValue(entry);

    expect(await loadCachedNBAPlayerProps(eventId)).toEqual([]);
    expect(readCache.mock.calls).toEqual([[discoveryKey]]);
  });

  it('returns no props when discovery exists but cached prices are missing', async () => {
    readCache.mockImplementation(async (key: string) => key === discoveryKey ? discovery() : null);

    expect(await loadCachedNBAPlayerProps(eventId)).toEqual([]);
    expect(readCache.mock.calls).toEqual([[discoveryKey], [pricesKey]]);
  });

  it('rejects a future quote receipt even when the book update is in the past', async () => {
    readCache.mockImplementation(async (key: string) => key === discoveryKey ? discovery() : prices(Date.now() + 1));

    expect(await loadCachedNBAPlayerProps(eventId)).toEqual([]);
    expect(readCache.mock.calls).toEqual([[discoveryKey], [pricesKey]]);
  });

  it('rejects a quote update later than its cache receipt', async () => {
    const entry = prices(Date.parse('2026-01-21T17:29:59Z'));
    readCache.mockImplementation(async (key: string) => key === discoveryKey ? discovery() : entry);

    expect(await loadCachedNBAPlayerProps(eventId)).toEqual([]);
  });

  it('rejects a cached payload for a different event', async () => {
    const entry = prices();
    entry.data.id = 'other-event';
    readCache.mockImplementation(async (key: string) => key === discoveryKey ? discovery() : entry);

    expect(await loadCachedNBAPlayerProps(eventId)).toEqual([]);
  });
});