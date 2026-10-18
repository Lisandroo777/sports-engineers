import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinderGameCoverage, FinderResult, FinderRunSummary } from '../../finder/engine';
import type { MLBGame } from '../../mlb/types';
import type { ResearchSession } from './session';

const mocks = vi.hoisted(() => ({ schedule: vi.fn(), finder: vi.fn(), cache: vi.fn(), save: vi.fn(),
  refresh: vi.fn(), enabled: vi.fn(), fetch: vi.fn() }));
vi.mock('../../mlb/schedule', () => ({ getMLBSchedule: mocks.schedule }));
vi.mock('../../finder/engine', async importOriginal => ({
  ...await importOriginal<typeof import('../../finder/engine')>(),
  runFinderDeepSearch: mocks.finder, getCachedMLBPrimaryMarkets: mocks.cache,
}));
vi.mock('../../odds/client', async importOriginal => ({
  ...await importOriginal<typeof import('../../odds/client')>(), withAutomaticOddsRefresh: mocks.refresh,
}));
vi.mock('../../odds/autoRefreshLedger', async importOriginal => ({
  ...await importOriginal<typeof import('../../odds/autoRefreshLedger')>(), isAutomaticOddsRefreshEnabled: mocks.enabled,
}));
vi.mock('./sessionStore', () => ({ saveResearchSession: mocks.save }));

import { applyRequestScope, createAgentContext, executeTool } from './tools';
import { buildResearchSession } from './session';

const today = '2026-10-16';
const tomorrow = '2026-10-17';
const now = `${today}T12:00:00Z`;
function game(id: string, away: string, home: string, date = today, status = 'Scheduled'): MLBGame {
  return { id, date, status, gameTime: `${date}T23:10:00Z`,
    awayTeam: { id: 147, name: away, abbreviation: 'AWY' }, homeTeam: { id: 111, name: home, abbreviation: 'HME' } };
}
const yankees = game('nyy-1', 'New York Yankees', 'Boston Red Sox');
const doubleheader = game('nyy-2', 'New York Yankees', 'Boston Red Sox');
const dodgers = game('lad', 'Los Angeles Dodgers', 'San Francisco Giants');
let scheduled: MLBGame[];
let coverage: FinderGameCoverage[];
let preflightFailure: boolean;

function resultFor(scheduledGame: MLBGame): FinderResult {
  return {
    sport: 'mlb', id: `prop-${scheduledGame.id}`, player: 'Fixture Pitcher', playerId: 123, teamId: 147,
    teamName: scheduledGame.awayTeam.name, opponentTeamId: 111, opponentName: scheduledGame.homeTeam.name,
    homeAway: 'away', gameTimeIso: scheduledGame.gameTime!, gameId: scheduledGame.id, eventId: `event-${scheduledGame.id}`,
    marketLabel: 'Pitcher Strikeouts', marketKey: 'pitcher_strikeouts', line: 5.5, side: 'over', isAlternate: false,
    bestBook: { sportsbookName: 'Fixture Book', odds: -110 }, availableBooks: 1,
    evPercent: null, projection: null, projectionUncertainty: null, finderScore: 10, grade: null,
    historical: { l5: '1/5', l10: '2/10', l20: '4/20', l40: '8/40', season: '6/30',
      l5Rate: 20, l10Rate: 20, l20Rate: 20, seasonRate: 20 },
    signals: [], concerns: [], marketUpdatedAt: `${today}T11:59:00Z`,
    marketMovement: { available: false, direction: 'unavailable', openingOdds: null, currentOdds: null,
      observedOverMinutes: null, pointCount: 0, label: null },
    outlierDependency: { available: false, sampleGames: 0, raw: { games: 0, total: 0, mean: 0 },
      withoutTopGame: { games: 0, total: 0, mean: 0 }, withoutTop2Games: { games: 0, total: 0, mean: 0 },
      explosiveDependencePercent: null, median: null, standardDeviation: null },
    volumeEfficiency: { available: false, basis: 'innings_pitched', estimatedVolume: null,
      requiredRatePerUnit: null, actualRatePerUnit: null, meetsRequiredRate: false },
    alternateLineOptimizer: { available: false, side: 'over', options: [], recommended: null },
    crossBookThreshold: { available: false, standardLines: [], discrepancy: false, spread: null },
    howItLoses: ['Insufficient evidence.'], sources: ['Offline fixture'],
  };
}
function coverageFor(scheduledGame: MLBGame, status: FinderGameCoverage['status'] = 'RESEARCHED'): FinderGameCoverage {
  return { gameId: scheduledGame.id, slateDate: scheduledGame.date, homeTeam: scheduledGame.homeTeam.name,
    awayTeam: scheduledGame.awayTeam.name, gameTime: scheduledGame.gameTime,
    eventId: status === 'NOT_LISTED' ? null : `event-${scheduledGame.id}`, eventTime: scheduledGame.gameTime, status };
}
function summary(date = today): FinderRunSummary {
  const results = coverage.filter(entry => entry.status === 'RESEARCHED').map(entry => resultFor(scheduled.find(row => row.id === entry.gameId)!));
  return { results, gameCoverage: coverage, gamesAnalyzed: results.length, gamesEligible: scheduled.length,
    gamesScheduled: scheduled.length, slateComplete: false, propsAnalyzed: results.length, eventsMatched: results.length,
    rawPropsTotal: results.length, booksAnalyzed: 1, analyzedAt: now, slateDate: date, credits: null,
    fromCache: true, cacheAgeMs: 60000, budgetLimited: coverage.some(entry => entry.status === 'BUDGET_BLOCKED'),
    blockReason: coverage.some(entry => entry.status === 'BUDGET_BLOCKED') ? 'VALIDATION_CREDIT_CAP' : null, oddsSpend: null };
}
function seed(): ResearchSession {
  const session = buildResearchSession({ sport: 'mlb', date: today, queryIntent: 'Best MLB props today',
    results: scheduled.map(resultFor), toolMeta: { gamesFound: scheduled.length, gamesScheduled: scheduled.length,
      propsFound: scheduled.length, booksFound: 1, candidatesFound: scheduled.length, researchComplete: true,
      cached: true, budgetLimited: false, dataFreshnessSeconds: 60 } });
  session.candidates.forEach(candidate => { candidate.priceCurrent = true; });
  return session;
}
async function run(query = 'Best MLB props today', session: ResearchSession | null = null) {
  const context = createAgentContext(session);
  applyRequestScope(context, query);
  const response = await executeTool('get_sportsbook_candidates', { sport: 'mlb', date: today }, context);
  return { response, context };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  vi.resetAllMocks();
  scheduled = [yankees, dodgers];
  coverage = scheduled.map(row => coverageFor(row));
  preflightFailure = false;
  mocks.schedule.mockImplementation(async () => scheduled);
  mocks.enabled.mockReturnValue(true);
  mocks.cache.mockResolvedValue(['pitcher_strikeouts']);
  mocks.refresh.mockImplementation(async operation => operation());
  mocks.save.mockResolvedValue('offline-session');
  mocks.fetch.mockImplementation(() => { throw new Error('Unexpected external call'); });
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.finder.mockImplementation(async (date: string, options: { preflight?: boolean }) => {
    const data = summary(date);
    if (!options.preflight) return data;
    if (preflightFailure) return { ...data, results: [], gamesEligible: 0, gameCoverage: scheduled.map(row => coverageFor(row, 'PROVIDER_ERROR')) };
    const games = coverage.filter(entry => entry.eventId).map(entry => ({ gameId: entry.gameId, eventId: entry.eventId,
      matchup: `${entry.awayTeam} @ ${entry.homeTeam}`, gameTime: entry.gameTime, status: 'Scheduled', marketsCacheState: 'CACHE_FRESH', selected: true }));
    return { ...data, results: [], validationPreflight: { eligibleGames: scheduled.length, matchedEvents: games.length,
      selectedValidationGames: games.length, cacheHits: games.length, cacheMisses: 0, estimatedPaidSubRequests: 0,
      estimatedCreditCostLow: 0, estimatedCreditCostExpected: 0, estimatedCreditCostHigh: 0,
      preflightState: games.length ? 'READY' : 'EVENT_LIST_REQUIRED', paidRefreshAuthorized: false, games } };
  });
});
afterEach(() => {
  expect(mocks.fetch).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('offline MLB schedule scope and coverage', () => {
  it.each(['MLB Mets props today', 'MLB Yankees vs Dodgers props today', 'MLB Yankees vs Unknown props today',
    'MLB Unknown @ Red Sox props today', 'MLB Unknown vs Mystery props today',
    'MLB Unknown vs Yankees Red Sox props today'])('never broadens absent or invalid scope: %s', async query => {
    const { response } = await run(query);
    expect(response).toMatchObject({ status: 'NOT_FOUND', gamesScheduled: 0 });
    expect(mocks.finder).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('selects every actual game for a named team including a doubleheader by ID', async () => {
    scheduled = [yankees, doubleheader, dodgers];
    coverage = scheduled.map(row => coverageFor(row));
    const { response, context } = await run('MLB NYY pitcher props today');
    expect(mocks.finder.mock.calls[1]).toEqual([today, { validationGameIds: ['nyy-1', 'nyy-2'] }]);
    expect(response).toMatchObject({ status: 'SUCCESS', gamesScheduled: 2, partialCoverage: false });
    expect(context.researchSession?.candidates.map(candidate => candidate.gameId)).toEqual(['nyy-1', 'nyy-2']);
    expect(response.mlbGameCoverage?.map(entry => entry.gameId)).toEqual(['nyy-1', 'nyy-2']);
  });

  it('pins tomorrow independently of model arguments and ignores schedule rows from today', async () => {
    scheduled = [yankees, { ...yankees, id: 'tomorrow', date: tomorrow, gameTime: `${tomorrow}T23:10:00Z` }, dodgers];
    coverage = scheduled.map(row => coverageFor(row));
    const { response } = await run('MLB Yankees vs Red Sox props tomorrow');
    expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith(tomorrow);
    expect(mocks.finder.mock.calls[1]).toEqual([tomorrow, { validationGameIds: ['tomorrow'] }]);
    expect(response).toMatchObject({ date: tomorrow, gamesScheduled: 1 });
    expect(response.mlbGameCoverage?.map(entry => entry.gameId)).toEqual(['tomorrow']);
  });

  it.each(['Final', 'In Progress', 'Postponed', 'Suspended', 'Cancelled'])('stops selected %s games before event discovery', async status => {
    scheduled = [{ ...yankees, status }, dodgers];
    const { response } = await run('MLB Yankees props today');
    expect(response).toMatchObject({ status: 'SLATE_COMPLETE', gamesScheduled: 0 });
    expect(mocks.finder).not.toHaveBeenCalled();
  });

  it('returns before discovery for an empty or wrong-date schedule', async () => {
    scheduled = [];
    expect((await run()).response.status).toBe('NO_GAMES');
    scheduled = [{ ...yankees, date: tomorrow }];
    expect((await run()).response.status).toBe('NO_GAMES');
    expect(mocks.finder).not.toHaveBeenCalled();
  });

  it('returns a structured free-schedule failure even with a stored session', async () => {
    const session = seed();
    mocks.schedule.mockRejectedValue(new Error('Schedule unavailable'));
    expect((await run('MLB props today', session)).response).toMatchObject({ status: 'PROVIDER_ERROR', researchComplete: false });
    expect(mocks.finder).not.toHaveBeenCalled();
  });

  it('does not research unrelated events when only the requested provider event is missing', async () => {
    coverage = [coverageFor(yankees, 'NOT_LISTED'), coverageFor(dodgers)];
    const { response } = await run('MLB Yankees props today');
    expect(response).toMatchObject({ status: 'EVENT_LIST_REQUIRED', gamesScheduled: 1 });
    expect(response.mlbGameCoverage).toEqual([coverageFor(yankees, 'NOT_LISTED')]);
    expect(mocks.finder).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it.each(['NO_MARKETS', 'NOT_LISTED', 'PROVIDER_ERROR', 'BUDGET_BLOCKED'] as const)('keeps %s games in full-slate coverage without forced picks', async status => {
    coverage = [coverageFor(yankees), coverageFor(dodgers, status)];
    const { response, context } = await run();
    expect(response).toMatchObject({ status: 'SUCCESS', gamesScheduled: 2, gamesFound: 1,
      partialCoverage: true, researchComplete: false, budgetLimited: status === 'BUDGET_BLOCKED' });
    expect(response.mlbGameCoverage?.map(entry => entry.status)).toEqual(['RESEARCHED', status]);
    expect(context.researchSession?.candidates).toHaveLength(1);
    expect(context.researchSession?.candidates.every(candidate => !candidate.eliteQualified)).toBe(true);
  });

  it('counts only eligible pregame games and ignores unrelated errors', async () => {
    scheduled = [yankees, { ...dodgers, status: 'In Progress' }];
    coverage = [coverageFor(yankees), coverageFor(dodgers, 'PROVIDER_ERROR')];
    const { response } = await run();
    expect(response).toMatchObject({ gamesScheduled: 1, partialCoverage: false, researchComplete: true });
    expect(response.mlbGameCoverage).toEqual([coverageFor(yankees)]);
    expect(mocks.finder.mock.calls[1][1]).toEqual({ validationGameIds: ['nyy-1'] });
  });

  it('does not let an unrelated provider error mark a specific scope incomplete', async () => {
    coverage = [coverageFor(yankees), coverageFor(dodgers, 'PROVIDER_ERROR')];
    expect((await run('MLB Yankees props today')).response).toMatchObject({ status: 'SUCCESS', gamesScheduled: 1, partialCoverage: false });
  });

  it('keeps cached-only partial coverage honest when paid refresh is disabled', async () => {
    mocks.enabled.mockReturnValue(false);
    coverage = [coverageFor(yankees), coverageFor(dodgers, 'NOT_LISTED')];
    const { response } = await run();
    expect(mocks.finder.mock.calls[1][1]).toEqual({ validationGameIds: ['nyy-1'] });
    expect(response).toMatchObject({ gamesScheduled: 2, partialCoverage: true, researchComplete: false });
    expect(response.mlbGameCoverage).toHaveLength(2);
  });

  it('distinguishes the preflight provider-error fallback from no posted markets', async () => {
    preflightFailure = true;
    const { response } = await run();
    expect(response).toMatchObject({ status: 'PROVIDER_ERROR', gamesScheduled: 2, partialCoverage: true, researchComplete: false });
    expect(mocks.finder).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it('never reuses a broad stored session for an absent or mismatched matchup', async () => {
    const session = seed();
    for (const query of ['MLB Mets props today', 'MLB Yankees vs Dodgers props today', 'MLB Yankees @ Unknown props today']) {
      expect((await run(query, session)).response.status).toBe('NOT_FOUND');
    }
    expect(mocks.finder).not.toHaveBeenCalled();
  });

  it('filters a fresh broad stored pool to the requested schedule IDs before returning it', async () => {
    const session = seed();
    const { response, context } = await run('MLB Yankees props today', session);
    expect(response).toMatchObject({ status: 'SUCCESS', reusedExistingSession: true, gamesScheduled: 1, candidatesFound: 1 });
    expect(context.researchSession?.candidates.map(candidate => candidate.gameId)).toEqual(['nyy-1']);
    expect(session.candidates).toHaveLength(2);
    expect(mocks.finder).not.toHaveBeenCalled();
  });

  it.each(['stale', 'missing-id', 'partial', 'missing-game'] as const)('does not conceal incomplete or outdated sessions: %s', async reason => {
    const session = seed();
    if (reason === 'stale') session.candidates[0].retrievedAt = `${today}T09:00:00Z`;
    if (reason === 'missing-id') session.candidates[0].gameId = 'obsolete';
    if (reason === 'partial') { session.toolMeta.partialCoverage = true; session.toolMeta.researchComplete = false; }
    if (reason === 'missing-game') { session.scopeGameIds = ['nyy-1']; session.candidates = session.candidates.slice(0, 1); }
    const { response } = await run('Best MLB props today', session);
    expect(response.reusedExistingSession).not.toBe(true);
    expect(mocks.finder).toHaveBeenCalledTimes(2);
  });

  it('does not reuse a previous-date session', async () => {
    const session = seed();
    const { response } = await run('Best MLB props tomorrow', session);
    expect(response.status).toBe('NO_GAMES');
    expect(response.reusedExistingSession).not.toBe(true);
  });

  it('does not substitute player props for a direct MLB game-market request', async () => {
    expect((await run('MLB Yankees moneyline today')).response).toMatchObject({ status: 'SPORTSBOOK_DATA_REQUIRED', researchComplete: false });
    expect(mocks.finder).not.toHaveBeenCalled();
  });
});