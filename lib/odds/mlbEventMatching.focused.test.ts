import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { matchOddsEvent, oddsEventSlateDate } from './match';
import type { MLBGame, MLBResearchGameLogs } from '../mlb/types';
import type { MLBResearchContext } from '../mlb/researchContext';
import type { NormalizedProp, OddsEvent } from './types';
import { getEventProps } from './eventProps';
import { runFinderDeepSearch } from '../finder/engine';
import { OddsBudgetGuardError, OddsRefreshNotAuthorizedError } from './client';

const mocks = vi.hoisted(() => ({
  schedule: vi.fn(), events: vi.fn(), discovered: vi.fn(), primaryProps: vi.fn(),
  cached: vi.fn(), persistent: vi.fn(), playerId: vi.fn(), cacheState: vi.fn(),
  researchContext: vi.fn(), playerContext: vi.fn(),
}));

vi.mock('../mlb/schedule', () => ({ getMLBSchedule: mocks.schedule }));
vi.mock('../mlb/researchContext', async (importOriginal) => ({
  ...await importOriginal<typeof import('../mlb/researchContext')>(),
  getMLBResearchContext: mocks.researchContext,
  withMLBPlayerContext: mocks.playerContext,
}));
vi.mock('../mlb/players', () => ({ findMLBPlayerIdByName: mocks.playerId, getMLBPlayer: async () => ({ currentTeam: { id: 1 } }) }));
vi.mock('../mlb/stats', async (importOriginal) => ({
  ...await importOriginal<typeof import('../mlb/stats')>(),
  getMLBResearchGameLogs: async (_id: number, slateDate: string): Promise<MLBResearchGameLogs> => ({
  season: 2026, slateDate, group: 'hitting', qualityNotes: [],
  regularSeason: [1, 2].map(index => ({ date: `2026-09-${20 + index}`, gamePk: 100 + index, gameType: 'R',
    opponent: 'Cleveland Guardians', homeAway: 'home', hits: 2, doubles: 1, triples: 0, homeRuns: 0,
    totalBases: 3, atBats: 4, plateAppearances: 4, strikeouts: 1 })),
  postseason: [{ date: '2026-10-10', gamePk: 200, gameType: 'D', opponent: 'Cleveland Guardians',
    homeAway: 'home', hits: 0, doubles: 0, triples: 0, homeRuns: 0, totalBases: 0, atBats: 4, plateAppearances: 4, strikeouts: 2 }],
}) }));
vi.mock('./persistentCache', () => ({ readPersistentCache: mocks.persistent }));
vi.mock('./snapshotStore', () => ({ recordSnapshot: vi.fn(), getSnapshotHistory: vi.fn().mockResolvedValue([]) }));
vi.mock('../finder/matchup', () => ({ buildMatchupSignal: vi.fn().mockResolvedValue({ available: false }) }));
vi.mock('./client', () => ({
  getOddsEvents: mocks.events,
  getDiscoveredEventPlayerProps: mocks.discovered,
  getEventPlayerProps: mocks.primaryProps,
  hasCachedEventMarkets: mocks.cached,
  inspectEventPlayerPropsCacheState: mocks.cacheState,
  getPropsCacheTtlMs: vi.fn().mockReturnValue(60_000),
  getLastOddsCreditInfo: vi.fn().mockReturnValue(null),
  getActiveOddsSpendTracker: vi.fn().mockReturnValue(null),
  beginOddsSpendTrackingAsync: vi.fn(),
  isPaidRefreshAllowed: vi.fn().mockReturnValue(false),
  OddsBudgetGuardError: class extends Error {},
  OddsRefreshNotAuthorizedError: class extends Error {},
}));

const game = (gameTime = '2026-10-16T23:10:00Z'): MLBGame => ({
  id: 'game-1', date: '2026-10-16', gameTime, status: 'Scheduled',
  homeTeam: { id: 1, name: 'New York Yankees', abbreviation: 'NYY' },
  awayTeam: { id: 2, name: 'Cleveland Guardians', abbreviation: 'CLE' },
});
const event = (id: string, commenceTime = '2026-10-16T23:10:00Z'): OddsEvent => ({
  id, commenceTime, homeTeam: 'New York Yankees', awayTeam: 'Cleveland Guardians',
});
const prop = (eventId: string): NormalizedProp => ({
  player: 'Test Batter', playerId: 123, marketKey: 'batter_hits', sourceMarketKey: 'batter_hits',
  isAlternate: false, historicalAnalysisAvailable: true, marketLabel: 'Hits', line: 0.5,
  overOdds: -110, underOdds: -110, sportsbookKey: 'test', sportsbookName: 'Test Book',
  eventId, lastUpdate: '2026-10-16T16:00:00Z',
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.schedule.mockResolvedValue([game()]);
  mocks.events.mockResolvedValue([event('listed')]);
  mocks.discovered.mockResolvedValue([]);
  mocks.primaryProps.mockResolvedValue([]);
  mocks.cached.mockResolvedValue(false);
  mocks.persistent.mockResolvedValue(null);
  mocks.playerId.mockResolvedValue(123);
  mocks.cacheState.mockResolvedValue({ props: 'CACHE_MISSING' });
  mocks.researchContext.mockImplementation(async (gameId: string) => {
    const unavailable = { status: 'UNAVAILABLE' as const, value: null, source: null,
      retrievedAt: '2026-10-16T16:00:00Z', sourceTimestamp: null, dataQualityNote: 'Offline fixture' };
    return { gameId, retrievedAt: unavailable.retrievedAt, sourceTimestamp: null, sources: [],
      dataQualityNote: 'Offline fixture', gameStatus: unavailable,
      probablePitchers: { home: unavailable, away: unavailable },
      confirmedLineups: { home: unavailable, away: unavailable }, weather: unavailable,
      venue: unavailable, playerInjuries: unavailable, bullpenWorkload: unavailable } satisfies MLBResearchContext;
  });
  mocks.playerContext.mockImplementation((context: MLBResearchContext) => context);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected network request')));
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe('MLB exact event matching', () => {
  it('requires both teams and home/away orientation for postseason games', () => {
    expect(matchOddsEvent(game(), [
      { ...event('wrong-opponent'), awayTeam: 'Detroit Tigers' },
      { ...event('reversed'), homeTeam: 'Cleveland Guardians', awayTeam: 'New York Yankees' },
      event('postseason'),
    ])?.id).toBe('postseason');
    expect(matchOddsEvent(game(), [{ ...event('wrong'), awayTeam: 'Detroit Tigers' }])).toBeNull();
  });

  it('selects the nearest actual doubleheader start independent of provider order', () => {
    const early = event('early', '2026-10-16T17:10:00Z');
    const late = event('late', '2026-10-16T23:15:00Z');
    expect(matchOddsEvent(game(), [early, late])?.id).toBe('late');
    expect(matchOddsEvent(game('2026-10-16T17:00:00Z'), [late, early])?.id).toBe('early');
  });

  it('uses Eastern slate dates across UTC rollover and rejects other days', () => {
    const late = event('rollover', '2026-10-17T01:10:00Z');
    expect(oddsEventSlateDate(late)).toBe('2026-10-16');
    expect(matchOddsEvent(game('2026-10-17T01:00:00Z'), [event('tomorrow', '2026-10-18T01:10:00Z'), late])?.id).toBe('rollover');
    expect(matchOddsEvent(game(), [event('yesterday', '2026-10-15T23:10:00Z')])).toBeNull();
    expect(matchOddsEvent(game(), [event('today')], '2026-10-17')).toBeNull();
  });

  it('retains team aliases and rejects invalid provider timestamps', () => {
    const athletics = { ...game(), homeTeam: { ...game().homeTeam, name: 'Oakland Athletics' } };
    expect(matchOddsEvent(athletics, [{ ...event('alias'), homeTeam: 'Athletics' }])?.id).toBe('alias');
    expect(matchOddsEvent(game(), [event('invalid', 'not-a-date')])).toBeNull();
  });
});

describe('MLB verified event props', () => {
  it('keeps legacy calls compatible but never falls back to one team', async () => {
    mocks.events.mockResolvedValue([{ ...event('wrong'), awayTeam: 'Detroit Tigers' }]);
    expect(await getEventProps('New York Yankees', 'Cleveland Guardians', '2026-10-16')).toEqual({ event: null, props: [] });
    expect(mocks.discovered).not.toHaveBeenCalled();
    mocks.events.mockResolvedValue([event('legacy')]);
    expect((await getEventProps('New York Yankees', 'Cleveland Guardians')).event?.id).toBe('legacy');
  });

  it('uses the verified event without rediscovery and resolves player IDs', async () => {
    mocks.discovered.mockResolvedValue([prop('verified')]);
    mocks.playerId.mockResolvedValue(123);
    const result = await getEventProps('New York Yankees', 'Cleveland Guardians', '2026-10-16', event('verified'), game().gameTime);
    expect(mocks.events).not.toHaveBeenCalled();
    expect(mocks.discovered).toHaveBeenCalledWith('verified', 60_000);
    expect(result.props[0].playerId).toBe(123);
  });

  it('does not fetch for explicit null, wrong matchup, or wrong-day verified events', async () => {
    for (const verified of [null, { ...event('wrong'), awayTeam: 'Detroit Tigers' }, event('other-day', '2026-10-17T23:10:00Z')]) {
      expect(await getEventProps('New York Yankees', 'Cleveland Guardians', '2026-10-16', verified)).toEqual({ event: null, props: [] });
    }
    expect(mocks.events).not.toHaveBeenCalled();
    expect(mocks.discovered).not.toHaveBeenCalled();
  });
});

describe('MLB engine event ownership and coverage', () => {
  it('fetches each doubleheader event once and preserves the selected event identity', async () => {
    mocks.schedule.mockResolvedValue([{ ...game('2026-10-16T17:00:00Z'), id: 'early-game' }, game()]);
    mocks.events.mockResolvedValue([event('late'), event('early', '2026-10-16T17:10:00Z')]);
    const summary = await runFinderDeepSearch('2026-10-16');
    expect(mocks.events).toHaveBeenCalledTimes(1);
    expect(mocks.discovered.mock.calls.map(call => call[0]).sort()).toEqual(['early', 'late']);
    expect(summary.gameCoverage).toEqual([
      expect.objectContaining({ gameId: 'early-game', eventId: 'early', status: 'NO_MARKETS' }),
      expect.objectContaining({ gameId: 'game-1', eventId: 'late', eventTime: game().gameTime, status: 'NO_MARKETS' }),
    ]);
    expect(summary.gamesAnalyzed).toBe(0);
    expect(summary.eventsMatched).toBe(2);
  });

  it('does not reuse the only listed doubleheader event for the other game', async () => {
    mocks.schedule.mockResolvedValue([{ ...game('2026-10-16T17:00:00Z'), id: 'early-game' }, game()]);
    const summary = await runFinderDeepSearch('2026-10-16');
    expect(mocks.discovered).toHaveBeenCalledTimes(1);
    expect(summary.gameCoverage).toEqual([
      expect.objectContaining({ gameId: 'early-game', eventId: null, status: 'NOT_LISTED' }),
      expect.objectContaining({ gameId: 'game-1', eventId: 'listed', status: 'NO_MARKETS' }),
    ]);
  });

  it('keeps the planned identity on the cached-primary props path', async () => {
    mocks.cached.mockResolvedValue(true);
    mocks.persistent.mockImplementation(async (url: string) => url.includes('/markets?')
      ? { data: { bookmakers: [{ markets: [{ key: 'batter_hits' }] }] } }
      : { data: { id: 'listed' } });
    mocks.primaryProps.mockResolvedValue([prop('listed')]);
    const summary = await runFinderDeepSearch('2026-10-16');
    expect(mocks.primaryProps).toHaveBeenCalledWith('listed', ['batter_hits'], 60_000);
    expect(mocks.discovered).not.toHaveBeenCalled();
    expect(mocks.events).toHaveBeenCalledTimes(1);
    expect(summary.gameCoverage?.[0]).toEqual(expect.objectContaining({ eventId: 'listed', status: 'RESEARCHED' }));
    expect(summary.gamesAnalyzed).toBe(1);
    expect(summary.results.every(result => result.eventId === 'listed')).toBe(true);
  });

  it('never fetches props for unmatched matchups or days', async () => {
    mocks.events.mockResolvedValue([
      { ...event('wrong-opponent'), awayTeam: 'Detroit Tigers' },
      event('wrong-day', '2026-10-17T23:10:00Z'),
    ]);
    const summary = await runFinderDeepSearch('2026-10-16');
    expect(mocks.discovered).not.toHaveBeenCalled();
    expect(mocks.primaryProps).not.toHaveBeenCalled();
    expect(mocks.persistent).not.toHaveBeenCalled();
    expect(summary.gameCoverage?.[0].status).toBe('NOT_LISTED');
    expect(summary.gamesAnalyzed).toBe(0);
  });

  it('researches a postseason game across UTC rollover with the same planned event', async () => {
    mocks.schedule.mockResolvedValue([game('2026-10-17T01:00:00Z')]);
    mocks.events.mockResolvedValue([event('rollover', '2026-10-17T01:10:00Z')]);
    mocks.discovered.mockResolvedValue([prop('rollover')]);
    const summary = await runFinderDeepSearch('2026-10-16');
    expect(summary.gamesAnalyzed).toBe(1);
    expect(summary.gameCoverage?.[0]).toEqual(expect.objectContaining({ status: 'RESEARCHED', eventId: 'rollover' }));
    expect(summary.results.length).toBeGreaterThan(0);
    expect(summary.results.every(result => result.eventId === 'rollover' && result.gameId === 'game-1')).toBe(true);
    for (const result of summary.results) {
      expect(result.projection).toBe(2);
      expect(result.mlbContext?.history).toMatchObject({ regularSeasonGames: 2, postseasonGames: 1,
        postseasonRecent: [{ date: '2026-10-10', gamePk: 200, gameType: 'D', value: 0 }] });
    }
  });

  it.each([
    [new Error('Provider unavailable'), 'PROVIDER_ERROR'],
    [new OddsBudgetGuardError('Reserve'), 'BUDGET_BLOCKED'],
    [new OddsRefreshNotAuthorizedError('Not authorized'), 'BUDGET_BLOCKED'],
  ])('does not count failed event requests as researched: %s', async (error, status) => {
    mocks.discovered.mockRejectedValue(error);
    const summary = await runFinderDeepSearch('2026-10-16');
    expect(summary.gameCoverage?.[0]).toEqual(expect.objectContaining({ eventId: 'listed', status }));
    expect(summary.gamesAnalyzed).toBe(0);
    expect(summary.eventsMatched).toBe(1);
  });

  it('records provider event-list failures without claiming successful research', async () => {
    mocks.events.mockRejectedValue(new Error('Event list unavailable'));
    const summary = await runFinderDeepSearch('2026-10-16');
    expect(summary.gameCoverage?.[0].status).toBe('PROVIDER_ERROR');
    expect(summary.gamesAnalyzed).toBe(0);
    expect(mocks.discovered).not.toHaveBeenCalled();
  });

  it('marks credit-cap blocks with event identity and performs no prop fetch', async () => {
    const summary = await runFinderDeepSearch('2026-10-16', { validationMaxCredits: 0 });
    expect(summary.gameCoverage?.[0]).toEqual(expect.objectContaining({ eventId: 'listed', status: 'BUDGET_BLOCKED' }));
    expect(summary.gamesSkippedByCreditCap).toBe(1);
    expect(summary.gamesAnalyzed).toBe(0);
    expect(mocks.discovered).not.toHaveBeenCalled();
  });

  it('leaves unselected and preflight games NOT_FETCHED', async () => {
    const skipped = await runFinderDeepSearch('2026-10-16', { validationGameIds: ['other-game'] });
    const preflight = await runFinderDeepSearch('2026-10-16', { preflight: true });
    expect(skipped.gameCoverage?.[0].status).toBe('NOT_FETCHED');
    expect(preflight.gameCoverage?.[0].status).toBe('NOT_FETCHED');
    expect(skipped.gamesAnalyzed).toBe(0);
    expect(preflight.gamesAnalyzed).toBe(0);
    expect(mocks.discovered).not.toHaveBeenCalled();
  });

  it('does not report zero-game or empty-market slates as researched', async () => {
    mocks.schedule.mockResolvedValue([]);
    const empty = await runFinderDeepSearch('2026-10-16');
    expect(empty.gameCoverage).toEqual([]);
    expect(empty.gamesAnalyzed).toBe(0);
    expect(empty.slateComplete).toBe(false);
    mocks.schedule.mockResolvedValue([game()]);
    mocks.discovered.mockResolvedValue([{ ...prop('listed'), overOdds: null, underOdds: null }]);
    const noPrices = await runFinderDeepSearch('2026-10-16');
    expect(noPrices.gameCoverage?.[0].status).toBe('NO_MARKETS');
    expect(noPrices.gamesAnalyzed).toBe(0);
  });
});