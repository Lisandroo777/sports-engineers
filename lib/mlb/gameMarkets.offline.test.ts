import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../odds/client';
import { MLB_GAME_MODEL_UNAVAILABLE, parseMLBGameMarketOdds, researchMLBGameMarkets } from './gameMarkets';
import type { OddsEvent } from '../odds/types';

const cache = vi.hoisted(() => new Map<string, { data: unknown; cachedAt: number; expiresAt: number }>());
vi.mock('../odds/persistentCache', () => ({
  readPersistentCache: async (key: string) => cache.get(key) ?? null,
  readStalePersistentCache: async () => null,
  writePersistentCache: async () => {},
  readCreditStatus: async () => ({ remaining: '20000', used: '0' }),
  writeCreditStatus: async () => {},
}));

const event: OddsEvent = { id: 'mlb-game-fixture', homeTeam: 'New York Yankees', awayTeam: 'Boston Red Sox', commenceTime: '2026-10-17T20:00:00Z' };
const updated = '2026-10-16T19:00:00Z';
type Outcome = { name: string; price?: unknown; point?: unknown; description?: string };
function market(key: string, outcomes: Outcome[]) { return { key, outcomes, last_update: updated }; }
function payload(markets: unknown[], id = event.id) {
  return { id, bookmakers: [{ key: 'fixture-book', title: 'Fixture Book', last_update: '2026-10-16T18:00:00Z', markets }] };
}
const teamSides: Outcome[] = [{ name: event.homeTeam, price: -120 }, { name: event.awayTeam, price: 110 }];
const totalSides: Outcome[] = [{ name: 'Over', point: 8.5, price: -110 }, { name: 'Under', point: 8.5, price: 100 }];

beforeEach(() => {
  vi.restoreAllMocks();
  cache.clear();
  vi.stubEnv('THE_ODDS_API_KEY', 'offline-fixture-only');
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network call in offline MLB game-market test'); }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('MLB game quote formats (offline)', () => {
  it('parses moneyline, runline, totals, F5 and exact book, team, line, price and update', () => {
    const parsed = parseMLBGameMarketOdds(event, payload([
      market('h2h', teamSides),
      market('spreads', [{ name: event.homeTeam, point: -1.5, price: 140 }, { name: event.awayTeam, point: 1.5, price: -160 }]),
      market('totals', totalSides),
      market('h2h_1st_5_innings', teamSides),
      market('spreads_1st_5_innings', [{ name: event.awayTeam, point: 0, price: -105 }]),
      market('totals_1st_5_innings', [{ name: 'Under', point: 4, price: -115 }]),
    ]));
    expect(parsed.issues).toEqual([]);
    expect(parsed.quotes).toHaveLength(10);
    expect(parsed.quotes[0]).toMatchObject({ eventId: event.id, team: event.homeTeam, outcome: event.homeTeam, line: null, americanOdds: -120, sportsbookKey: 'fixture-book', sportsbookName: 'Fixture Book', lastUpdate: updated });
    expect(parsed.quotes[0].impliedProbability).toBeCloseTo(120 / 220);
    expect(parsed.quotes[1].impliedProbability).toBeCloseTo(100 / 210);
    expect(parsed.quotes[2]).toMatchObject({ kind: 'runline', line: -1.5, team: event.homeTeam });
    expect(parsed.quotes[4]).toMatchObject({ kind: 'total', line: 8.5, team: null });
    expect(parsed.quotes[6]).toMatchObject({ period: 'first_five', settlement: 'two_way_push_on_tie' });
    expect(parsed.quotes[8]).toMatchObject({ settlement: 'push_on_exact_line', line: 0 });
    expect(parsed.quotes[9]).toMatchObject({ settlement: 'push_on_exact_line', line: 4 });
    for (const quote of parsed.quotes) expect(quote).toMatchObject({ modelProbability: null, edge: null, recommendation: false, reason: MLB_GAME_MODEL_UNAVAILABLE });
  });

  it('maps first-inning Under/Over to NRFI/YRFI only at exactly 0.5', () => {
    const parsed = parseMLBGameMarketOdds(event, payload([market('totals_1st_1_innings', [
      { name: 'Under', point: 0.5, price: -125 }, { name: 'Over', point: 0.5, price: 105 },
      { name: 'Under', point: 1.5, price: -200 }, { name: 'Over', point: 0, price: 100 },
      { name: 'NRFI', point: 0.5, price: 100 }, { name: 'Under', point: '0.5', price: 100 },
    ])]));
    expect(parsed.quotes.map((quote) => [quote.outcome, quote.selection, quote.line])).toEqual([['Under', 'NRFI', 0.5], ['Over', 'YRFI', 0.5]]);
    expect(parsed.quotes.every((quote) => quote.kind === 'nrfi_yrfi' && quote.period === 'first_inning')).toBe(true);
    expect(parsed.issues[0].code).toBe('invalid_quotes');
  });

  it('requires exact team-total description and keeps both teams and alternate thresholds separate', () => {
    const parsed = parseMLBGameMarketOdds(event, payload([
      market('team_totals', [
        { name: 'Over', description: event.homeTeam, point: 4.5, price: -110 },
        { name: 'Under', description: event.awayTeam, point: 3.5, price: 110 },
        { name: 'Over', description: 'Yankees', point: 4.5, price: 100 },
        { name: 'Over', point: 4.5, price: 100 },
      ]),
      market('alternate_team_totals', [{ name: 'Under', description: event.homeTeam, point: 6.5, price: -200 }]),
    ]));
    expect(parsed.quotes.map((quote) => [quote.team, quote.outcome, quote.line, quote.isAlternate])).toEqual([
      [event.homeTeam, 'Over', 4.5, false], [event.awayTeam, 'Under', 3.5, false], [event.homeTeam, 'Under', 6.5, true],
    ]);
  });

  it('retains F5 draws, three-way identities and every alternate line', () => {
    const parsed = parseMLBGameMarketOdds(event, payload([
      market('h2h_1st_5_innings', [...teamSides, { name: 'Draw', price: 210 }]),
      market('h2h_3_way_1st_5_innings', [...teamSides, { name: 'Draw', price: 220 }]),
      market('h2h_3_way', [...teamSides, { name: 'Draw', price: 900 }]),
      market('alternate_spreads', [{ name: event.homeTeam, point: -2.5, price: 200 }, { name: event.homeTeam, point: -3.5, price: 300 }]),
      market('alternate_totals', totalSides),
      market('alternate_spreads_1st_5_innings', [{ name: event.awayTeam, point: 1.5, price: -200 }]),
      market('alternate_totals_1st_5_innings', [{ name: 'Over', point: 2.5, price: -220 }]),
    ]));
    expect(parsed.quotes).toHaveLength(15);
    expect(parsed.quotes.filter((quote) => quote.outcome === 'Draw')).toHaveLength(3);
    expect(parsed.quotes.slice(0, 9).every((quote) => quote.settlement === 'three_way')).toBe(true);
    expect(parsed.quotes[2]).toMatchObject({ team: null, outcome: 'Draw', line: null, americanOdds: 210 });
    expect(parsed.quotes.filter((quote) => quote.isAlternate)).toHaveLength(6);
  });

  it.each([undefined, null, 0, 99, -99, NaN, Infinity, '110', 100.5])('rejects missing or invalid American odds: %s', (price) => {
    expect(parseMLBGameMarketOdds(event, payload([market('h2h', [{ name: event.homeTeam, price }])])).quotes).toEqual([]);
  });

  it('rejects missing/invalid lines and nonmatching teams without inventing quotes', () => {
    const parsed = parseMLBGameMarketOdds(event, payload([
      market('spreads', [{ name: 'Yankees', point: -1.5, price: -110 }, { name: event.homeTeam, price: 100 }, { name: event.homeTeam, point: Infinity, price: 100 }]),
      market('totals', [{ name: 'Over', price: 100 }, { name: 'Under', point: -1, price: 100 }, { name: 'Under', point: NaN, price: 100 }]),
      market('h2h', [{ name: event.homeTeam, point: 1, price: 100 }]),
      market('batter_hits', totalSides),
    ]));
    expect(parsed.quotes).toEqual([]);
    expect(parsed.issues[0].code).toBe('invalid_quotes');
  });

  it('handles missing books, markets, malformed payload and mismatched identities', () => {
    for (const raw of [null, {}, payload([], 'wrong-event'), { ...payload([]), home_team: 'Wrong Team' }]) {
      expect(parseMLBGameMarketOdds(event, raw).issues[0].code).toBe('invalid_payload');
    }
    for (const raw of [{ id: event.id }, { id: event.id, bookmakers: [] }]) {
      expect(parseMLBGameMarketOdds(event, raw).issues[0].code).toBe('missing_books');
    }
    expect(parseMLBGameMarketOdds(event, payload([])).quotes).toEqual([]);
    expect(parseMLBGameMarketOdds(event, { id: event.id, bookmakers: [null] }).issues[0].code).toBe('invalid_quotes');
  });

  it('falls back only to a real book update and otherwise leaves the timestamp null', () => {
    const raw = payload([{ key: 'h2h', outcomes: teamSides }]);
    expect(parseMLBGameMarketOdds(event, raw).quotes[0].lastUpdate).toBe('2026-10-16T18:00:00Z');
    raw.bookmakers[0].last_update = 'invalid';
    expect(parseMLBGameMarketOdds(event, raw).quotes[0].lastUpdate).toBeNull();
  });
});

describe('MLB per-event research (offline)', () => {
  it('discovers only posted allowlisted keys and reports partially missing data', async () => {
    const discover = vi.spyOn(client, 'getEventMarkets').mockResolvedValue({ 'Fixture Book': ['totals', 'h2h', 'batter_hits', 'totals', 'not_real'] });
    const odds = vi.spyOn(client, 'getMLBGameMarketOdds').mockResolvedValue(payload([market('h2h', teamSides)]));
    const result = await researchMLBGameMarkets([event]);
    expect(discover).toHaveBeenCalledExactlyOnceWith(event.id, 'baseball_mlb');
    expect(odds).toHaveBeenCalledExactlyOnceWith(event.id, ['h2h', 'totals'], undefined);
    expect(result.events[0]).toMatchObject({ status: 'partial', missingMarkets: ['totals'] });
    expect(result.quotes).toHaveLength(2);
  });

  it('accepts known discovery, including empty discovery, without duplicate calls', async () => {
    const discover = vi.spyOn(client, 'getEventMarkets');
    const odds = vi.spyOn(client, 'getMLBGameMarketOdds').mockResolvedValue(payload([market('h2h', teamSides)]));
    const result = await researchMLBGameMarkets([event], { discoveryByEventId: { [event.id]: { 'Fixture Book': ['h2h'] } }, cacheTtlMs: 1234 });
    expect(result.events[0].status).toBe('complete');
    expect(odds).toHaveBeenCalledExactlyOnceWith(event.id, ['h2h'], 1234);
    expect(discover).not.toHaveBeenCalled();
    odds.mockClear();
    expect((await researchMLBGameMarkets([event], { discoveryByEventId: { [event.id]: {} } })).events[0].status).toBe('empty');
    expect(discover).not.toHaveBeenCalled();
    expect(odds).not.toHaveBeenCalled();
  });

  it('records budget, authorization and provider failures per stage and continues other events', async () => {
    const events = ['budget', 'auth', 'provider', 'odds-failure', 'ok'].map((id) => ({ ...event, id }));
    vi.spyOn(client, 'getEventMarkets')
      .mockRejectedValueOnce(new client.OddsBudgetGuardError('reserve blocked'))
      .mockRejectedValueOnce(new client.OddsRefreshNotAuthorizedError('scope required'))
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValue({ 'Fixture Book': ['h2h'] });
    vi.spyOn(client, 'getMLBGameMarketOdds').mockRejectedValueOnce(new client.OddsBudgetGuardError('ceiling reached'))
      .mockResolvedValue(payload([market('h2h', teamSides)], 'ok'));
    const result = await researchMLBGameMarkets(events);
    expect(result.events.map((item) => item.status)).toEqual(['unavailable', 'unavailable', 'unavailable', 'unavailable', 'complete']);
    expect(result.events.slice(0, 4).map((item) => [item.issues[0].stage, item.issues[0].code])).toEqual([
      ['discovery', 'budget_blocked'], ['discovery', 'refresh_not_authorized'], ['discovery', 'provider_error'], ['odds', 'budget_blocked'],
    ]);
    expect(result.quotes).toHaveLength(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reports no posted game keys, missing books, and invalid prices explicitly', async () => {
    vi.spyOn(client, 'getEventMarkets').mockResolvedValueOnce({ Book: ['batter_hits'] }).mockResolvedValue({ Book: ['h2h'] });
    const odds = vi.spyOn(client, 'getMLBGameMarketOdds').mockResolvedValueOnce({ id: event.id, bookmakers: [] })
      .mockResolvedValueOnce(payload([market('h2h', [{ name: event.homeTeam, price: 0 }])]));
    expect((await researchMLBGameMarkets([event])).events[0].status).toBe('empty');
    expect(odds).not.toHaveBeenCalled();
    const noBooks = (await researchMLBGameMarkets([event])).events[0];
    expect(noBooks.status).toBe('unavailable');
    expect(noBooks.issues.map((issue) => issue.code)).toEqual(['missing_books', 'missing_markets']);
    expect((await researchMLBGameMarkets([event])).events[0].issues[0].code).toBe('invalid_quotes');
  });

  it('keeps available quotes but marks a missing discovered book partial', async () => {
    vi.spyOn(client, 'getEventMarkets').mockResolvedValue({ 'Fixture Book': ['h2h'], 'Missing Book': ['h2h'], 'Props Only': ['batter_hits'] });
    vi.spyOn(client, 'getMLBGameMarketOdds').mockResolvedValue(payload([market('h2h', teamSides)]));
    const result = (await researchMLBGameMarkets([event])).events[0];
    expect(result.status).toBe('partial');
    expect(result.quotes).toHaveLength(2);
    expect(result.missingMarkets).toEqual([]);
    expect(result.issues).toEqual([{ stage: 'odds', code: 'missing_books', message: 'No valid game quotes returned for posted books: Missing Book.' }]);
  });

  it.each([
    [new Error('provider offline'), 'provider_error'],
    [new client.OddsRefreshNotAuthorizedError('caller scope exhausted'), 'refresh_not_authorized'],
  ])('records an odds-stage failure without erasing prior event quotes: %s', async (error, code) => {
    vi.spyOn(client, 'getEventMarkets').mockResolvedValue({ 'Fixture Book': ['h2h'] });
    vi.spyOn(client, 'getMLBGameMarketOdds').mockResolvedValueOnce(payload([market('h2h', teamSides)])).mockRejectedValueOnce(error);
    const result = await researchMLBGameMarkets([event, { ...event, id: 'failed-second-event' }]);
    expect(result.quotes).toHaveLength(2);
    expect(result.events[1]).toMatchObject({ status: 'unavailable', missingMarkets: ['h2h'], issues: [{ stage: 'odds', code }] });
  });
});

describe('real client cache and authorization boundary (offline)', () => {
  it('serves cached discovery and raw game odds without a scope or network', async () => {
    const discoveryKey = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${event.id}/markets?regions=us`;
    const oddsKey = `https://api.the-odds-api.com/v4/sports/baseball_mlb/events/${event.id}/odds?regions=us&markets=h2h&oddsFormat=american`;
    const entry = (data: unknown) => ({ data, cachedAt: Date.now(), expiresAt: Date.now() + 60000 });
    cache.set(discoveryKey, entry({ bookmakers: [{ title: 'Fixture Book', markets: [{ key: 'h2h' }] }] }));
    cache.set(oddsKey, entry(payload([market('h2h', teamSides)])));
    const result = await researchMLBGameMarkets([event]);
    expect(result.events[0].status).toBe('complete');
    expect(result.quotes).toHaveLength(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not authorize or spend on a cache miss even when automatic refresh is enabled', async () => {
    vi.stubEnv('ODDS_AUTO_REFRESH', 'true');
    vi.stubEnv('ODDS_ALLOW_PAID_REFRESH', 'true');
    const uncached = { ...event, id: 'offline-uncached-game' };
    const result = await researchMLBGameMarkets([uncached]);
    expect(result.events[0].issues[0].code).toBe('refresh_not_authorized');
    await expect(client.getMLBGameMarketOdds(uncached.id, ['h2h'])).rejects.toBeInstanceOf(client.OddsRefreshNotAuthorizedError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('enforces an explicit under-50 allowlist, deduplicates and rejects injection before network', async () => {
    expect(client.MLB_GAME_MARKET_KEYS.length).toBeLessThan(50);
    expect(new Set(client.MLB_GAME_MARKET_KEYS).size).toBe(client.MLB_GAME_MARKET_KEYS.length);
    for (const key of ['batter_hits', 'h2h,totals', 'unknown', 'player_points']) {
      await expect(client.getMLBGameMarketOdds('offline-allowlist-game', [key])).rejects.toThrow('Unsupported MLB game market');
    }
    await expect(client.getMLBGameMarketOdds('../invalid', ['h2h'])).rejects.toThrow('exact MLB provider event ID');
    expect(await client.getMLBGameMarketOdds('offline-empty-game', [])).toEqual({ id: 'offline-empty-game', bookmakers: [] });
    const url = new URL('https://api.the-odds-api.com/v4/sports/baseball_mlb/events/offline-order-game/odds');
    url.searchParams.set('regions', 'us');
    url.searchParams.set('markets', 'h2h,totals');
    url.searchParams.set('oddsFormat', 'american');
    const raw = { id: 'offline-order-game', bookmakers: [] };
    cache.set(url.toString(), { data: raw, cachedAt: Date.now(), expiresAt: Date.now() + 60000 });
    expect(await client.getMLBGameMarketOdds('offline-order-game', ['totals', 'h2h', 'h2h'])).toEqual(raw);
    expect(fetch).not.toHaveBeenCalled();
  });
});