import { describe, expect, it, vi } from 'vitest';
import { createNBAContextProvider } from './provider';

function rawGame(id: string, day: number) {
  return { id, date: `2026-01-${String(day).padStart(2, '0')}T20:00:00Z`, season: { year: 2026, type: 2 }, competitions: [{ date: `2026-01-${String(day).padStart(2, '0')}T20:00:00Z`, status: { type: { completed: day < 21 } }, competitors: [{ homeAway: 'home', team: { id: '1' }, score: '100' }, { homeAway: 'away', team: { id: '2' }, score: '90' }] }] };
}

describe('free provider boundaries', () => {
  it('deduplicates snapshots and requests, bounds concurrency, and never reaches sportsbook hosts', async () => {
    let active = 0;
    let maximum = 0;
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async input => {
      active += 1;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active -= 1;
      const url = new URL(String(input));
      expect(url.hostname).toBe('site.api.espn.com');
      const data = url.pathname.endsWith('/summary') ? { header: rawGame(url.searchParams.get('event')!, url.searchParams.get('event') === '100' ? 21 : 1), plays: [] }
        : url.pathname.endsWith('/schedule') ? { events: [rawGame('10', 1)] } : { timestamp: '2026-01-20T12:00:00Z', injuries: [] };
      return new Response(JSON.stringify(data));
    });
    const provider = createNBAContextProvider({ fetcher, now: () => new Date('2026-01-20T18:00:00Z') });
    const request = { gameId: '100', teamId: 1 };
    const [first, second] = await Promise.all([provider.loadSnapshot(request), provider.loadSnapshot(request)]);
    expect(first).toBe(second);
    expect(maximum).toBeLessThanOrEqual(4);
    expect(provider.requestsUsed()).toBe(9);
    expect(fetcher).toHaveBeenCalledTimes(9);
  });
  it('respects a hard request budget and reports partial failures', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ header: rawGame('100', 21) })));
    const provider = createNBAContextProvider({ fetcher, maxRequests: 1, now: () => new Date('2026-01-20T18:00:00Z') });
    const snapshot = await provider.loadSnapshot({ gameId: '100', teamId: 1 });
    expect(snapshot.injuryFeed.state).toBe('UNAVAILABLE');
    expect(snapshot.missing.join(' ')).toContain('budget');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects path injection, invalid target and future historical asOf', async () => {
    const provider = createNBAContextProvider({ fetcher: vi.fn(), now: () => new Date('2026-01-20') });
    await expect(provider.loadSnapshot({ gameId: '../odds', teamId: 1 })).rejects.toThrow('Numeric');
    await expect(provider.loadSnapshot({ gameId: '100', teamId: 1, asOf: '2027-01-01' })).rejects.toThrow('asOf');
    expect(() => createNBAContextProvider({ maxRequests: Number.NaN })).toThrow('bounded');
    expect(() => createNBAContextProvider({ maxGamesPerTeam: 1000 })).toThrow('bounded');
  });
  it('reserves injury-feed access before bounded historical schedule work', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async input => new Response(JSON.stringify(String(input).endsWith('/injuries')
      ? { timestamp: '2026-01-20T18:00:00Z', injuries: [] } : { header: rawGame('100', 21) })));
    const provider = createNBAContextProvider({ fetcher, maxRequests: 2, now: () => new Date('2026-01-20T18:00:00Z') });
    const snapshot = await provider.loadSnapshot({ gameId: '100', teamId: 1 });
    expect(snapshot.injuryFeed.state).toBe('AVAILABLE');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not treat a malformed feed with a timestamp as a valid no-injury report', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async input => new Response(JSON.stringify(String(input).endsWith('/injuries')
      ? { timestamp: '2026-01-20T18:00:00Z' } : { header: rawGame('100', 21) })));
    const snapshot = await createNBAContextProvider({ fetcher, maxRequests: 2, now: () => new Date('2026-01-20T18:00:00Z') }).loadSnapshot({ gameId: '100', teamId: 1 });
    expect(snapshot.injuryFeed.state).toBe('UNAVAILABLE');
    expect(snapshot.missing.join(' ')).toContain('malformed');
  });
});