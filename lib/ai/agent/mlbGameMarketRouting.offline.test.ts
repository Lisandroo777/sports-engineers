import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MLBGame } from '../../mlb/types';
import type { OddsEvent } from '../../odds/types';

const mocks = vi.hoisted(() => ({ schedule: vi.fn(), events: vi.fn(), research: vi.fn(), execute: vi.fn(),
  scope: vi.fn(), scopeDepth: 0, fetch: vi.fn() }));

vi.mock('../../mlb/schedule', () => ({ getMLBSchedule: mocks.schedule }));
vi.mock('../../mlb/gameMarkets', async importOriginal => ({
  ...await importOriginal<typeof import('../../mlb/gameMarkets')>(), researchMLBGameMarkets: mocks.research,
}));
vi.mock('../../odds/client', async importOriginal => ({
  ...await importOriginal<typeof import('../../odds/client')>(), getOddsEvents: mocks.events,
  withAutomaticOddsRefresh: mocks.scope,
}));
vi.mock('./sessionStore', () => ({ getResearchSession: vi.fn(async () => null), saveResearchSession: vi.fn() }));
vi.mock('./tools', async importOriginal => ({
  ...await importOriginal<typeof import('./tools')>(), executeTool: mocks.execute,
}));

import { runAgentTurn, toClientResult } from './runner';
import { interpretBettingIntent, isMLBGameMarketRequest } from '../../../communication/intent';
import { parseMLBGameMarketOdds } from '../../mlb/gameMarkets';

const today = '2026-10-16';
const tomorrow = '2026-10-17';
function game(id: string, away: string, home: string, date = today, status = 'Scheduled'): MLBGame {
  return { id, date, status, gameTime: `${date}T23:10:00Z`,
    awayTeam: { id: 1, name: away, abbreviation: 'AWY' }, homeTeam: { id: 2, name: home, abbreviation: 'HME' } };
}
const yankees = game('nyy', 'New York Yankees', 'Boston Red Sox');
const dodgers = game('lad', 'Los Angeles Dodgers', 'San Francisco Giants');
function eventFor(scheduled: MLBGame): OddsEvent {
  return { id: `odds-${scheduled.id}`, awayTeam: scheduled.awayTeam.name,
    homeTeam: scheduled.homeTeam.name, commenceTime: scheduled.gameTime };
}
function turn(query: string, uiContext?: { sport: 'mlb'; date?: string }) {
  return runAgentTurn([{ role: 'user', content: query }], null, null, uiContext);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${today}T12:00:00Z`));
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.clearAllMocks();
  mocks.scopeDepth = 0;
  mocks.scope.mockImplementation(async operation => {
    mocks.scopeDepth += 1;
    try { return await operation(); } finally { mocks.scopeDepth -= 1; }
  });
  mocks.schedule.mockImplementation(async (date: string) => [yankees, dodgers].map(row => ({
    ...row, date, gameTime: `${date}T23:10:00Z`,
  })));
  mocks.events.mockResolvedValue([yankees, dodgers, { ...yankees, date: tomorrow, gameTime: `${tomorrow}T23:10:00Z`, id: 'nyy-tomorrow' }].map(eventFor));
  mocks.research.mockImplementation(async (events: OddsEvent[]) => {
    expect(mocks.scopeDepth).toBe(1);
    const reports = events.map(event => ({ event, status: 'complete', requestedMarkets: ['h2h'], missingMarkets: [], issues: [],
      quotes: parseMLBGameMarketOdds(event, { id: event.id, bookmakers: [{ key: 'fixture', title: 'Fixture Book',
        markets: [{ key: 'h2h', outcomes: [{ name: event.homeTeam, price: -110 }] }] }] }, ['h2h']).quotes }));
    return { events: reports, quotes: reports.flatMap(report => report.quotes) };
  });
  mocks.execute.mockResolvedValue({ status: 'NO_CANDIDATES', researchComplete: false });
  mocks.fetch.mockImplementation(() => { throw new Error('Unexpected external request'); });
  vi.stubGlobal('fetch', mocks.fetch);
});

afterEach(() => {
  expect(mocks.fetch).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('offline MLB game-market routing', () => {
  it.each(['moneyline', 'moneylines', 'run lines', 'runlines', 'totals', 'game totals', 'team totals',
    'F5', 'first five innings', 'first-5', 'NRFI', 'YRFI', 'spreads'])('routes explicit %s to quotes without props or model calls', async market => {
    const query = `Best MLB ${market} today`;
    expect(interpretBettingIntent(query).unsupportedMarket).toBeNull();
    const result = toClientResult(await turn(query), true);
    expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith(today);
    expect(mocks.research).toHaveBeenCalledExactlyOnceWith([eventFor(yankees), eventFor(dodgers)]);
    expect(mocks.scope).toHaveBeenCalledTimes(1);
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(result.results).toEqual([]);
    expect(result.closestMisses).toEqual([]);
    expect(result.mlbGameMarkets?.quotes).toHaveLength(2);
    expect(result.mlbGameMarkets?.quotes[0]).toMatchObject({ modelProbability: null, edge: null, recommendation: false });
    expect(result.reply).toMatch(/prices are available.*no validated MLB game-model probability or edge/);
    expect(result.meta).toMatchObject({ sport: 'mlb', date: today, status: 'UNMODELED_QUOTES',
      coverage: 'MLB_GAME_MARKET_QUOTES', gamesScheduled: 2, gamesFound: 2, quotesFound: 2,
      qualifiedCandidates: 0, researchComplete: false, quoteCoverageComplete: true, partialCoverage: false });
  });

  it('resolves tomorrow from the query ahead of the UI date and matches the exact event date', async () => {
    const result = await turn('MLB Yankees vs Red Sox F5 tomorrow', { sport: 'mlb', date: today });
    expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith(tomorrow);
    expect(mocks.research.mock.calls[0][0].map((event: OddsEvent) => event.id)).toEqual(['odds-nyy-tomorrow']);
    expect(result.meta).toMatchObject({ date: tomorrow, gamesMatched: 1 });
  });

  it.each(['MLB NYY vs BOS moneyline today', 'MLB Yankees moneyline today', 'MLB Yankees @ Red Sox NRFI today'])('keeps matchup/team scope for %s', async query => {
    await turn(query);
    expect(mocks.research).toHaveBeenCalledExactlyOnceWith([eventFor(yankees)]);
  });

  it.each(['MLB Yankees vs Dodgers totals today', 'MLB Mets moneyline today', 'MLB Yankees vs Unknown totals today'])('does not broaden an unmatched request: %s', async query => {
    const result = await turn(query);
    expect(result.meta).toMatchObject({ status: 'NOT_FOUND', gamesMatched: 0, researchComplete: false });
    expect(mocks.events).not.toHaveBeenCalled();
    expect(mocks.research).not.toHaveBeenCalled();
  });

  it('does not use schedule rows or odds from another date', async () => {
    mocks.schedule.mockResolvedValue([{ ...yankees, date: tomorrow }]);
    const result = await turn('MLB Yankees moneyline today');
    expect(result.meta?.status).toBe('NO_GAMES_SCHEDULED');
    expect(mocks.research).not.toHaveBeenCalled();
    mocks.schedule.mockResolvedValue([yankees]);
    mocks.events.mockResolvedValue([eventFor({ ...yankees, gameTime: `${tomorrow}T23:10:00Z` })]);
    expect((await turn('MLB Yankees moneyline today')).meta?.status).toBe('EVENT_LIST_REQUIRED');
    expect(mocks.research).toHaveBeenCalledExactlyOnceWith([]);
  });

  it('reports an empty schedule without fetching markets', async () => {
    mocks.schedule.mockResolvedValue([]);
    const result = await turn('MLB full slate totals today');
    expect(result.meta).toMatchObject({ status: 'NO_GAMES_SCHEDULED', gamesScheduled: 0 });
    expect(result.mlbGameMarkets).toEqual({ events: [], quotes: [] });
    expect(mocks.events).not.toHaveBeenCalled();
  });

  it.each(['In Progress', 'Final', 'Postponed', 'Suspended', 'Cancelled'])('skips %s games without substituting another matchup', async status => {
    mocks.schedule.mockResolvedValue([{ ...yankees, status }, dodgers]);
    const result = await turn('MLB Yankees moneyline today');
    expect(result.meta).toMatchObject({ status: 'SLATE_COMPLETE', gamesMatched: 1, gamesEligible: 0, gamesSkipped: 1 });
    expect(mocks.research).not.toHaveBeenCalled();
  });

  it('fetches only pregame games for an entire slate', async () => {
    mocks.schedule.mockResolvedValue([{ ...yankees, status: 'In Progress' }, dodgers]);
    const result = await turn('MLB full slate run lines today');
    expect(mocks.research).toHaveBeenCalledExactlyOnceWith([eventFor(dodgers)]);
    expect(result.meta).toMatchObject({ gamesEligible: 1, gamesSkipped: 1 });
  });

  it.each(['schedule', 'events', 'research'] as const)('handles thrown %s failures without props substitution', async stage => {
    mocks[stage].mockRejectedValue(new Error('Provider failed'));
    const result = await turn('MLB moneyline today');
    expect(result.meta).toMatchObject({ status: 'PROVIDER_ERROR', researchComplete: false, partialCoverage: true });
    expect(result.results).toEqual([]);
    expect(result.reply).toMatch(/currently unavailable/);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each(['empty', 'unavailable'] as const)('distinguishes %s event coverage', async status => {
    mocks.research.mockImplementation(async (events: OddsEvent[]) => ({ quotes: [], events: events.map(event => ({
      event, status, quotes: [], requestedMarkets: [], missingMarkets: [],
      issues: [{ stage: 'discovery', code: status === 'empty' ? 'missing_markets' : 'provider_error', message: 'Fixture' }],
    })) }));
    const result = await turn('MLB NRFI today');
    expect(result.meta).toMatchObject({ status: status === 'empty' ? 'MARKETS_NOT_POSTED' : 'SPORTSBOOK_DATA_REQUIRED',
      researchComplete: false, quoteCoverageComplete: false });
    expect(result.mlbGameMarkets?.events).toHaveLength(2);
    expect(result.results).toEqual([]);
  });

  it('retains partial quote evidence without claiming complete quote coverage', async () => {
    const complete = mocks.research.getMockImplementation()!;
    mocks.research.mockImplementation(async (events: OddsEvent[]) => {
      const report = await complete(events);
      report.events[0].status = 'partial';
      return report;
    });
    const result = await turn('MLB moneyline today');
    expect(result.meta).toMatchObject({ status: 'UNMODELED_QUOTES', partialCoverage: true, researchComplete: false });
    expect(result.mlbGameMarkets?.quotes).toHaveLength(2);
  });

  it('keeps broad best MLB plays and total bases on the props path', async () => {
    expect(isMLBGameMarketRequest('Best MLB total bases props today')).toBe(false);
    await turn('Best MLB plays today');
    expect(mocks.execute).toHaveBeenCalledWith('get_sportsbook_candidates', { sport: 'mlb', date: today }, expect.anything());
    expect(mocks.research).not.toHaveBeenCalled();
  });

  it.each([{ researchComplete: false }, { partialCoverage: true }])('does not claim completed MLB prop research for %j', async coverage => {
    mocks.execute.mockImplementation(async (name: string) => name === 'get_sportsbook_candidates'
      ? { status: 'SUCCESS', sport: 'mlb', date: today, ...coverage }
      : { status: 'SUCCESS', data: { results: [], closestMisses: [] } });
    const result = await turn('Best MLB plays today');
    expect(result.meta?.researchComplete).toBe(false);
    expect(result.reply).toMatch(/partial coverage/);
    expect(result.reply).not.toMatch(/research complete/i);
    expect(mocks.research).not.toHaveBeenCalled();
  });

  it('preserves NFL/NBA unsupported-market interpretation and education', async () => {
    expect(interpretBettingIntent('Best NFL moneyline picks today').unsupportedMarket).toBe('moneyline');
    expect(interpretBettingIntent('Best NBA moneyline picks today').unsupportedMarket).toBe('moneyline');
    await turn('Explain MLB moneyline odds');
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.research).not.toHaveBeenCalled();
  });
});