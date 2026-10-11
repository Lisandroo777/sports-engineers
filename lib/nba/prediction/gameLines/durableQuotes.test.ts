import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCachedNBAGameQuotes } from './quotes';
import { binding } from './fixtures';

const key = 'https://api.the-odds-api.com/v4/sports/basketball_nba/events/odds-1/odds?regions=us&markets=h2h,spreads,totals,team_totals&oddsFormat=american';
const receipt = Date.parse('2026-01-21T17:31:00Z');
const expiry = Date.parse('2026-01-21T18:30:00Z');
const request = { cacheKey: key, binding, predictionAt: '2026-01-21T18:00:00Z' };

function payload() {
  return { key, cachedAt: receipt, expiresAt: expiry, data: { id: binding.eventId, sport_key: 'basketball_nba',
    home_team: binding.homeTeam, away_team: binding.awayTeam, commence_time: '2026-01-21T23:00:00Z',
    bookmakers: [{ key: 'fixture', title: 'Fixture Book', markets: [
      { key: 'h2h', last_update: '2026-01-21T17:30:00Z', outcomes: [{ name: 'Home', price: -120 }] },
      { key: 'spreads', last_update: '2026-01-21T17:30:00Z', outcomes: [{ name: 'Away', price: -110, point: 3.5 }] },
      { key: 'totals', last_update: '2026-01-21T17:30:00Z', outcomes: [{ name: 'Under', price: -110, point: 210.5 }] },
      { key: 'team_totals', last_update: '2026-01-21T17:30:00Z', outcomes: [{ name: 'Over', description: 'Home', price: 105, point: 110.5 }] },
    ] }] } };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(request.predictionAt));
  vi.stubEnv('KV_REST_API_URL', 'https://storage.example');
  vi.stubEnv('KV_REST_API_TOKEN', 'fixture-token');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('actual persistent-cache to KV to GAME quote adapter', () => {
  it('uses one storage GET and retains all four exact market identities and timestamps', async () => {
    const fetcher = vi.fn(async (url: string, options: RequestInit) => {
      expect(url).toBe('https://storage.example');
      expect(JSON.parse(options.body as string)).toEqual(['GET', `odds-cache:${createHash('sha1').update(key).digest('hex')}`]);
      return Response.json({ result: JSON.stringify(payload()) });
    });
    vi.stubGlobal('fetch', fetcher);
    const result = await loadCachedNBAGameQuotes(request);
    expect(result.status).toBe('AVAILABLE');
    expect(result.quotes.map(quote => [quote.market, quote.selection, quote.team, quote.line, quote.americanOdds])).toEqual([
      ['MONEYLINE', 'HOME', 'HOME', null, -120], ['SPREAD', 'AWAY', 'AWAY', 3.5, -110],
      ['TOTAL', 'UNDER', null, 210.5, -110], ['TEAM_TOTAL', 'OVER', 'HOME', 110.5, 105],
    ]);
    expect(result.quotes.every(quote => Date.parse(quote.observedAt) === receipt && quote.updatedAt === '2026-01-21T17:30:00Z')).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['missing', 'expired', 'malformed', 'wrong-key'] as const)('fails closed for %s storage data without a provider fallback', async variant => {
    const entry = payload();
    if (variant === 'expired') entry.expiresAt = Date.parse(request.predictionAt);
    if (variant === 'wrong-key') entry.key = key.replace('basketball_nba', 'football_nfl');
    const fetcher = vi.fn(async (url: string) => {
      expect(url).toBe('https://storage.example');
      return Response.json({ result: variant === 'missing' ? null : variant === 'malformed' ? 'invalid JSON' : JSON.stringify(entry) });
    });
    vi.stubGlobal('fetch', fetcher);
    expect((await loadCachedNBAGameQuotes(request)).quotes).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});