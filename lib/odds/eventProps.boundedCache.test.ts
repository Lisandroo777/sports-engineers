import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ discovered: vi.fn(), primary: vi.fn(async () => []), cache: vi.fn() }));
vi.mock('./client', async importOriginal => ({ ...await importOriginal<typeof import('./client')>(), getDiscoveredEventPlayerProps: mocks.discovered, getEventPlayerProps: mocks.primary,
  getOddsEvents: async () => [{ id: 'event', homeTeam: 'Los Angeles Dodgers', awayTeam: 'Milwaukee Brewers', commenceTime: '2026-10-15T00:00:00Z' }],
  getPropsCacheTtlMs: () => 300000 }));
vi.mock('./persistentCache', () => ({ readPersistentCache: mocks.cache }));
vi.mock('../mlb/players', () => ({ findMLBPlayerIdByName: vi.fn() }));
import { getCachedMLBPrimaryMarkets } from '../finder/engine';

describe('exact bounded primary quote cache', () => {
  it('uses an exact fresh primary-subset receipt without requesting every discovered market', async () => {
    mocks.cache.mockImplementation(async (key: string) => key.includes('/markets?')
      ? { data: { bookmakers: [{ markets: [{ key: 'batter_hits' }, { key: 'batter_hits_alternate' }, { key: 'pitcher_strikeouts' }] }] } }
      : { data: { id: 'event' } });
    expect(await getCachedMLBPrimaryMarkets('event')).toEqual(['batter_hits', 'pitcher_strikeouts']);
    expect(mocks.discovered).not.toHaveBeenCalled();
  });
});