import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OddsEvent } from '../../../odds/types';
import type { PersistentCacheEntry } from '../../../odds/persistentCache';
import { NBA_ACTIVATION_MARKETS, nbaActivationCacheKey } from '../activationCache';
import { loadCachedNBAPlayerProps } from '../cachedProps';
import { loadCachedNBAEventResearch } from './cachedEventResearch';
import { loadCachedNBAGameQuotes } from './quotes';
import { searchNBAPlayers } from '../../players';
import { getNBAPlayerGameLogs } from '../../stats';
import { normalizeNBAResearchFilter } from '../../researchMarkets';

const mocks = vi.hoisted(() => ({ fresh: vi.fn(), stale: vi.fn(), events: vi.fn(), fetch: vi.fn() }));
vi.mock('../../../odds/persistentCache', () => ({
  readPersistentCache: mocks.fresh,
  readStalePersistentCache: mocks.stale,
}));
vi.mock('../../../odds/client', () => ({ getOddsEventsForSport: mocks.events }));
vi.mock('../../players', () => ({ searchNBAPlayers: vi.fn() }));
vi.mock('../../stats', () => ({ getNBAPlayerGameLogs: vi.fn() }));

const date = '2026-01-21';
const now = '2026-01-21T18:00:00.000Z';
const observedAt = '2026-01-21T17:31:00.000Z';
const updatedAt = '2026-01-21T17:30:00.000Z';
const eventId = '0123456789abcdef0123456789abcdef';
const otherEventId = 'fedcba9876543210fedcba9876543210';
const event: OddsEvent = { id: eventId, homeTeam: 'Boston Celtics', awayTeam: 'Los Angeles Lakers',
  commenceTime: '2026-01-21T23:00:00.000Z' };
const key = nbaActivationCacheKey(eventId);
const binding = { sourceGameId: eventId, eventId, homeTeam: event.homeTeam, awayTeam: event.awayTeam };
const request = { cacheKey: key, binding, predictionAt: now };

function rawPayload() {
  return { id: eventId, sport_key: 'basketball_nba', home_team: event.homeTeam, away_team: event.awayTeam,
    commence_time: event.commenceTime, season_type: 'UNKNOWN', bookmakers: [{ key: 'draftkings', title: 'DraftKings',
      last_update: updatedAt, markets: [
        { key: 'h2h', last_update: updatedAt, outcomes: [
          { name: event.homeTeam, price: -135 }, { name: event.awayTeam, price: 115 },
        ] },
        { key: 'spreads', last_update: updatedAt, outcomes: [
          { name: event.homeTeam, point: -3.5, price: -110 }, { name: event.awayTeam, point: 3.5, price: -105 },
        ] },
        { key: 'totals', last_update: updatedAt, outcomes: [
          { name: 'Over', point: 224.5, price: -115 }, { name: 'Under', point: 224.5, price: -105 },
        ] },
        { key: 'team_totals', last_update: updatedAt, outcomes: [
          { name: 'Over', description: event.homeTeam, point: 114.5, price: -120 },
          { name: 'Under', description: event.homeTeam, point: 114.5, price: 100 },
          { name: 'Over', description: event.awayTeam, point: 110.5, price: -110 },
          { name: 'Under', description: event.awayTeam, point: 110.5, price: -110 },
        ] },
        ...[
          { key: 'player_points', point: 26.5 }, { key: 'player_rebounds', point: 8.5 },
          { key: 'player_assists', point: 5.5 },
        ].map(market => ({ key: market.key, last_update: updatedAt, outcomes: [
          { name: 'Over', description: 'Fixture Player', point: market.point, price: -125 },
          { name: 'Under', description: 'Fixture Player', point: market.point, price: 105 },
        ] })),
      ] }] };
}

type Receipt = PersistentCacheEntry<ReturnType<typeof rawPayload>>;
let receipt: Receipt;

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  receipt = { key, cachedAt: Date.parse(observedAt), expiresAt: Date.parse(now) - 5 * 60_000, data: rawPayload() };
  mocks.fresh.mockImplementation(async (requestedKey: string) =>
    requestedKey === key && receipt.expiresAt > Date.now() ? receipt : null);
  mocks.stale.mockImplementation(async (requestedKey: string) => requestedKey === key ? receipt : null);
  mocks.events.mockResolvedValue([event]);
  mocks.fetch.mockImplementation(() => { throw new Error('Network forbidden in cached research tests'); });
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
  try { expect(mocks.fetch).not.toHaveBeenCalled(); }
  finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
});

describe('real cached NBA event research with one retained mixed-market receipt', () => {
  it('enriches selected mapped props with descriptive and opponent evidence while keeping predictions null', async () => {
    vi.mocked(searchNBAPlayers).mockResolvedValue([{ id: 10, name: 'Fixture Player', team: { id: 1, name: event.homeTeam, displayName: event.homeTeam, abbreviation: 'BOS', logoUrl: null }, position: null, jersey: null, headshotUrl: null }]);
    vi.mocked(getNBAPlayerGameLogs).mockResolvedValue([{ gameId: 'prior', date: '2026-01-19T18:00:00Z', season: 2026, phase: 'REGULAR',
      opponent: event.awayTeam, opponentAbbreviation: 'LAL', homeAway: 'home', result: 'W', stats: { points: 30, totalRebounds: 10, assists: 7 } }]);
    const inputs = await loadCachedNBAEventResearch(date, [event], normalizeNBAResearchFilter({ marketIds: ['player_points'] }));
    const points = inputs.filter(input => input.subject.market.key === 'points');
    expect(points).toHaveLength(2);
    for (const input of points) {
      expect(input).toMatchObject({ tierDecision: null, trueProbability: null, modelProbability: null, evPercent: null });
      expect(input.researchEvidence?.find(evidence => evidence.category === 'OPPONENT_HISTORY')?.detail).toContain(`against ${event.awayTeam}: 1 completed REGULAR games`);
      expect(input.researchEvidence?.find(evidence => evidence.category === 'DESCRIPTIVE_HISTORY')?.detail).toContain('mean 30.00');
    }
    expect(getNBAPlayerGameLogs).toHaveBeenCalledTimes(1);
    expect(inputs.filter(input => input.subject.market.key === 'assists').every(input => input.researchEvidence?.length === 1)).toBe(true);
  });
  it('researches extra real contracts but keeps them out of model candidates and preserves Yes/No semantics', async () => {
    for (const marketKey of ['player_field_goals', 'player_frees_made', 'player_frees_attempts', 'player_blocks_steals', 'player_double_double', 'player_triple_double', 'player_fantasy_points']) {
      const binary = ['player_double_double', 'player_triple_double'].includes(marketKey);
      receipt.data.bookmakers[0].markets.push({ key: marketKey, last_update: updatedAt, outcomes: [
        { name: binary ? 'Yes' : 'Over', description: 'Fixture Player', ...(binary ? {} : { point: 3.5 }), price: -125 },
        { name: binary ? 'No' : 'Under', description: 'Fixture Player', ...(binary ? {} : { point: 3.5 }), price: 105 },
      ] } as typeof receipt.data.bookmakers[0]['markets'][number]);
    }
    vi.mocked(searchNBAPlayers).mockResolvedValue([{ id: 10, name: 'Fixture Player', team: { id: 1, name: event.homeTeam, displayName: event.homeTeam, abbreviation: 'BOS', logoUrl: null }, position: null, jersey: null, headshotUrl: null }]);
    vi.mocked(getNBAPlayerGameLogs).mockResolvedValue([{ gameId: 'prior', date: '2026-01-19T18:00:00Z', season: 2026, phase: 'REGULAR',
      opponent: 'Fixture', opponentAbbreviation: 'FIX', homeAway: 'home', result: 'W',
      stats: { fieldGoalsMade: 8, freeThrowsMade: 4, freeThrowsAttempted: 6, points: 20, totalRebounds: 10, assists: 11, blocks: 1, steals: 2 } }]);
    expect(await loadCachedNBAPlayerProps(eventId, event.commenceTime)).toHaveLength(3);
    const inputs = await loadCachedNBAEventResearch(date, [event]);
    expect(inputs).toHaveLength(30);
    const extra = inputs.filter(input => input.subject.market.key.startsWith('player_'));
    expect(extra).toHaveLength(14);
    for (const input of extra) {
      expect(input).toMatchObject({ tierDecision: null, trueProbability: null, modelProbability: null, evPercent: null });
      if (input.subject.market.key !== 'player_fantasy_points') expect(input.researchEvidence?.some(evidence => evidence.detail.includes('1 completed REGULAR games'))).toBe(true);
      else expect(input.missing).toContain('DFS-only quote. Provider-specific fantasy scoring rules are not connected; no fantasy score formula assumed.');
      if (input.subject.market.key === 'player_double_double') expect(input.subject.market).toMatchObject({ line: 0.5, label: expect.stringContaining('Yes = Over 0.5') });
    }
    expect(getNBAPlayerGameLogs).toHaveBeenCalledTimes(1);
  });
  it('uses the exact lowercase 32-hex event and activation key without rewriting the receipt', async () => {
    expect(eventId).toMatch(/^[a-f0-9]{32}$/);
    expect(key).toBe(`https://api.the-odds-api.com/v4/sports/basketball_nba/events/${eventId}/odds?regions=us&markets=player_points%2Cplayer_rebounds%2Cplayer_assists%2Ch2h%2Cspreads%2Ctotals%2Cteam_totals&oddsFormat=american`);
    expect(new URL(key).searchParams.get('markets')).toBe(NBA_ACTIVATION_MARKETS);
    const original = structuredClone(receipt);
    const inputs = await loadCachedNBAEventResearch(date, [event]);
    expect(inputs).toHaveLength(16);
    expect(mocks.stale.mock.calls).toEqual([[`nba:research-receipt:v1:${eventId}:us,us2`], [key], [key]]);
    expect(mocks.fresh.mock.calls).toEqual([[`nba:research-receipt:v1:${eventId}:us,us2`], [key], [
      `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${eventId}/markets?regions=us`,
    ], [key]]);
    expect(receipt).toEqual(original);
    expect(mocks.events).not.toHaveBeenCalled();
  });

  it('returns actual game quote fields for every supported raw game contract', async () => {
    const result = await loadCachedNBAGameQuotes(request);
    expect(result.status).toBe('AVAILABLE');
    expect(result.reason).toBeNull();
    expect(result.quotes.map(quote => [quote.market, quote.selection, quote.team, quote.line, quote.americanOdds])).toEqual([
      ['MONEYLINE', 'HOME', 'HOME', null, -135], ['MONEYLINE', 'AWAY', 'AWAY', null, 115],
      ['SPREAD', 'HOME', 'HOME', -3.5, -110], ['SPREAD', 'AWAY', 'AWAY', 3.5, -105],
      ['TOTAL', 'OVER', null, 224.5, -115], ['TOTAL', 'UNDER', null, 224.5, -105],
      ['TEAM_TOTAL', 'OVER', 'HOME', 114.5, -120], ['TEAM_TOTAL', 'UNDER', 'HOME', 114.5, 100],
      ['TEAM_TOTAL', 'OVER', 'AWAY', 110.5, -110], ['TEAM_TOTAL', 'UNDER', 'AWAY', 110.5, -110],
    ]);
    for (const quote of result.quotes) expect(quote).toMatchObject({ provider: 'THE_ODDS_API', eventId,
      homeTeam: event.homeTeam, awayTeam: event.awayTeam, commenceTime: event.commenceTime,
      sportsbookKey: 'draftkings', sportsbook: 'DraftKings', updatedAt, observedAt, period: 'FULL_GAME' });
  });

  it('parses the actual core prop contracts from the same retained receipt', async () => {
    const props = await loadCachedNBAPlayerProps(eventId);
    expect(props.map(prop => [prop.sourceMarketKey, prop.marketKey, prop.line, prop.overOdds, prop.underOdds])).toEqual([
      ['player_points', 'points', 26.5, -125, 105], ['player_rebounds', 'rebounds', 8.5, -125, 105],
      ['player_assists', 'assists', 5.5, -125, 105],
    ]);
    for (const prop of props) expect(prop).toMatchObject({ eventId, player: 'Fixture Player', sportsbookKey: 'draftkings',
      sportsbookName: 'DraftKings', lastUpdate: updatedAt, isAlternate: false, historicalAnalysisAvailable: true });
  });

  it('retains odds and evidence for both subjects but never fabricates confidence, tiers or season certainty', async () => {
    const inputs = await loadCachedNBAEventResearch(date, [event]);
    expect(inputs.filter(input => input.subject.kind === 'GAME_LINE')).toHaveLength(10);
    expect(inputs.filter(input => input.subject.kind === 'PLAYER_PROP')).toHaveLength(6);
    expect(new Set(inputs.map(input => input.candidateId)).size).toBe(16);
    for (const input of inputs) {
      expect(input).toMatchObject({ sportsbook: 'DraftKings', quoteStatus: 'CURRENT', tierDecision: null,
        trueProbability: null, modelProbability: null, evPercent: null, researchScore: null,
        seasonPhase: null, seasonPhaseCertainty: 'MISSING', subject: { gameId: eventId } });
      expect(input.americanOdds).toEqual(expect.any(Number));
      expect(input.missing).toEqual([expect.stringContaining('Exact ESPN event/season/model binding')]);
      expect(input.researchEvidence).toEqual([expect.objectContaining({ category: 'VERIFIED_QUOTE',
        source: 'THE_ODDS_API', stance: 'CONTEXT',
        observedAt: input.subject.kind === 'GAME_LINE' ? observedAt : updatedAt,
        detail: expect.stringContaining(`quote updated ${updatedAt}`) })]);
      if (input.subject.kind === 'PLAYER_PROP') expect(input.subject.player).toEqual({ id: null, name: 'Fixture Player', team: null });
    }
  });

  it('preserves normalized selections and odds in research subjects', async () => {
    const inputs = await loadCachedNBAEventResearch(date, [event]);
    expect(inputs.map(input => [input.subject.market, input.americanOdds])).toEqual([
      ...[
        ['MONEYLINE', 'HOME', 'HOME', null, -135], ['MONEYLINE', 'AWAY', 'AWAY', null, 115],
        ['SPREAD', 'HOME', 'HOME', -3.5, -110], ['SPREAD', 'AWAY', 'AWAY', 3.5, -105],
        ['TOTAL', 'OVER', null, 224.5, -115], ['TOTAL', 'UNDER', null, 224.5, -105],
        ['TEAM_TOTAL', 'OVER', 'HOME', 114.5, -120], ['TEAM_TOTAL', 'UNDER', 'HOME', 114.5, 100],
        ['TEAM_TOTAL', 'OVER', 'AWAY', 110.5, -110], ['TEAM_TOTAL', 'UNDER', 'AWAY', 110.5, -110],
      ].map(([market, selection, team, line, odds]) => [{ key: market, label: market, type: market, selection, team, line }, odds]),
      ...[['points', 'Points', 26.5], ['rebounds', 'Rebounds', 8.5], ['assists', 'Assists', 5.5]]
        .flatMap(([market, label, line]) => [
          [{ key: market, label, line, side: 'over' }, -125], [{ key: market, label, line, side: 'under' }, 105],
        ]),
    ]);
  });

  it('uses fresh cache before retained cache and keeps the same current quote semantics', async () => {
    receipt.expiresAt = Date.parse(now) + 60_000;
    expect(await loadCachedNBAEventResearch(date, [event])).toHaveLength(16);
    expect(mocks.stale.mock.calls).toEqual([[`nba:research-receipt:v1:${eventId}:us,us2`]]);
    expect(mocks.fresh).toHaveBeenCalledWith(key);
  });

  it('uses mocked event discovery when no events are supplied, without network access', async () => {
    expect(await loadCachedNBAEventResearch(date)).toHaveLength(16);
    expect(mocks.events.mock.calls).toEqual([['basketball_nba']]);
  });

  it('fails closed when mocked event discovery rejects', async () => {
    mocks.events.mockRejectedValue(new Error('No cached event listing'));
    expect(await loadCachedNBAEventResearch(date)).toEqual([]);
    expect(mocks.fresh.mock.calls).toEqual([[`nba:research-events:v1:${date}`]]);
    expect(mocks.stale).not.toHaveBeenCalled();
  });

  it.each(['2026-01-20', '2026-01-22'])('does not read or return events for wrong requested date %s', async wrongDate => {
    expect(await loadCachedNBAEventResearch(wrongDate, [event])).toEqual([]);
    expect(mocks.fresh).not.toHaveBeenCalled();
    expect(mocks.stale).not.toHaveBeenCalled();
  });

  it.each(['2026-01-22T23:00:00Z', now, '2026-01-21T17:59:59Z'])('rejects listed wrong-date or started tipoff %s', async commenceTime => {
    expect(await loadCachedNBAEventResearch(date, [{ ...event, commenceTime }])).toEqual([]);
    expect(mocks.fresh).not.toHaveBeenCalled();
    expect(mocks.stale).not.toHaveBeenCalled();
  });

  it.each(['odds-1', eventId.toUpperCase(), `${eventId}0`])('rejects non-exact provider event ID %s before cache reads', async id => {
    expect(await loadCachedNBAEventResearch(date, [{ ...event, id }])).toEqual([]);
    expect(mocks.fresh).not.toHaveBeenCalled();
    expect(mocks.stale).not.toHaveBeenCalled();
  });

  it('rejects the wrong event in the retained payload for both subject types', async () => {
    receipt.data.id = otherEventId;
    expect(await loadCachedNBAEventResearch(date, [event])).toEqual([]);
  });

  it.each([
    nbaActivationCacheKey(otherEventId), key.replace('api.the-odds-api.com', 'fake-provider.example'),
  ])('rejects a retained receipt with the wrong original request key: %s', async storedKey => {
    receipt.key = storedKey;
    expect(await loadCachedNBAEventResearch(date, [event])).toEqual([]);
  });

  it('rejects a retained payload whose tipoff is on the wrong date', async () => {
    receipt.data.commence_time = '2026-01-22T23:00:00.000Z';
    expect(await loadCachedNBAEventResearch(date, [event])).toEqual([]);
  });

  it('rejects a fake provider host before either cache reader is called', async () => {
    const result = await loadCachedNBAGameQuotes({ ...request, cacheKey: key.replace('api.the-odds-api.com', 'fake-provider.example') });
    expect(result.status).toBe('UNSUPPORTED_QUOTE');
    expect(result.quotes).toEqual([]);
    expect(mocks.fresh).not.toHaveBeenCalled();
    expect(mocks.stale).not.toHaveBeenCalled();
  });

  it('does not retain odds or numeric confidence when every quote is more than one hour old', async () => {
    for (const market of receipt.data.bookmakers[0].markets) market.last_update = '2026-01-21T16:59:59.000Z';
    expect(await loadCachedNBAEventResearch(date, [event])).toEqual([]);
  });

  it('accepts the exact one-hour quote boundary without assigning confidence', async () => {
    for (const market of receipt.data.bookmakers[0].markets) market.last_update = '2026-01-21T17:00:00.000Z';
    const inputs = await loadCachedNBAEventResearch(date, [event]);
    expect(inputs).toHaveLength(16);
    expect(inputs.every(input => input.modelProbability === null && input.tierDecision === null)).toBe(true);
  });

  it('rejects a future receipt for both subject types', async () => {
    receipt.cachedAt = Date.parse(now) + 1;
    expect(await loadCachedNBAEventResearch(date, [event])).toEqual([]);
  });

  it.each(['2026-01-21T17:31:00.001Z', '2026-01-21T18:00:00.001Z'])('rejects quotes after their receipt or the clock: %s', async timestamp => {
    for (const market of receipt.data.bookmakers[0].markets) market.last_update = timestamp;
    expect(await loadCachedNBAEventResearch(date, [event])).toEqual([]);
  });

  it('returns no candidates when both cache readers miss, without refreshing', async () => {
    mocks.fresh.mockResolvedValue(null);
    mocks.stale.mockResolvedValue(null);
    expect(await loadCachedNBAEventResearch(date, [event])).toEqual([]);
    expect(mocks.events).not.toHaveBeenCalled();
  });
});