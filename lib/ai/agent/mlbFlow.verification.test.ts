import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinderResult, FinderRunSummary } from '../../finder/engine';
import type { ResearchSession } from './session';
import type { MLBContextEvidence, MLBResearchContext } from '../../mlb/researchContext';

const { finderMock, scheduleMock, cachedPrimaryMarketsMock, gameMarketsMock, oddsEventsMock, sessions, getSessionMock, saveSessionMock } = vi.hoisted(() => {
  const sessions = new Map<string, ResearchSession>();
  return {
    sessions,
    finderMock: vi.fn(),
    scheduleMock: vi.fn(),
    cachedPrimaryMarketsMock: vi.fn(),
    gameMarketsMock: vi.fn(),
    oddsEventsMock: vi.fn(),
    getSessionMock: vi.fn(async (id: string | null) => id ? sessions.get(id) ?? null : null),
    saveSessionMock: vi.fn(async (session: ResearchSession) => {
      const id = 'mlb-verification-session';
      sessions.set(id, structuredClone(session));
      return id;
    }),
  };
});

vi.mock('../../finder/engine', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../finder/engine')>(),
  runFinderDeepSearch: finderMock,
  getCachedMLBPrimaryMarkets: cachedPrimaryMarketsMock,
}));
vi.mock('../../mlb/schedule', () => ({
  getMLBSchedule: scheduleMock,
}));
vi.mock('../../mlb/gameMarkets', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../mlb/gameMarkets')>(),
  researchMLBGameMarkets: gameMarketsMock,
}));
vi.mock('../../odds/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../odds/client')>(),
  getOddsEvents: oddsEventsMock,
}));
vi.mock('./sessionStore', () => ({
  getResearchSession: getSessionMock,
  saveResearchSession: saveSessionMock,
  deleteResearchSession: vi.fn(),
}));

import { POST } from '../../../app/api/ai/chat/route';
import { buildResearchSession } from './session';
import { parseMLBGameMarketOdds } from '../../mlb/gameMarkets';
import type { OddsEvent } from '../../odds/types';

const slateDate = '2026-10-04';
const now = '2026-10-04T12:00:00.000Z';
const query = 'Find me the best MLB pitcher strikeout props today';

function syntheticContext(): MLBResearchContext {
  const available = <Value>(value: Value): MLBContextEvidence<Value> => ({ status: 'AVAILABLE', value,
    source: 'Synthetic MLB verification fixture', retrievedAt: now, sourceTimestamp: now,
    dataQualityNote: 'Synthetic test evidence, not live MLB facts' });
  const unavailable = <Value>(): MLBContextEvidence<Value> => ({ status: 'UNAVAILABLE', value: null,
    source: null, retrievedAt: now, sourceTimestamp: null, dataQualityNote: 'Not supplied by synthetic fixture' });
  return {
    gameId: 'mlb-game-1', retrievedAt: now, sourceTimestamp: now,
    sources: ['Synthetic MLB verification fixture'], dataQualityNote: 'Synthetic test evidence only',
    gameStatus: unavailable(),
    probablePitchers: { home: available({ id: 543037, fullName: 'Gerrit Cole' }), away: unavailable() },
    confirmedLineups: { home: available(Array.from({ length: 9 }, (_, index) => ({
      id: 592450 + index, fullName: index === 0 ? 'Aaron Judge' : `Synthetic Batter ${index + 1}`, battingOrder: index + 1,
    }))), away: unavailable() },
    weather: unavailable(), venue: unavailable(), bullpenWorkload: unavailable(),
    playerInjuries: available([{ playerId: 543037, name: 'Gerrit Cole', code: 'A', description: 'Synthetic active status', explicitlyInjured: false },
      { playerId: 592450, name: 'Aaron Judge', code: 'A', description: 'Synthetic active status', explicitlyInjured: false }]),
  };
}

function syntheticFinderResult(overrides: Partial<FinderResult> = {}): FinderResult {
  return {
    sport: 'mlb', id: 'mlb-cole-strikeouts', player: 'Gerrit Cole', playerId: 543037,
    teamId: 147, teamName: 'New York Yankees', opponentTeamId: 111, opponentName: 'Boston Red Sox',
    homeAway: 'home', gameTimeIso: '2026-10-04T19:00:00Z', gameId: 'mlb-game-1', eventId: 'mlb-event-1',
    marketLabel: 'Pitcher Strikeouts', marketKey: 'pitcher_strikeouts', line: 5.5, side: 'over', isAlternate: false,
    bestBook: { sportsbookName: 'Fixture Book', odds: -110 }, availableBooks: 3,
    evPercent: 30, projection: 8, projectionUncertainty: 1.5, finderScore: 95, grade: null,
    historical: { l5: '5/5', l10: '9/10', l20: '18/20', l40: '36/40', season: '27/30',
      l5Rate: 100, l10Rate: 90, l20Rate: 90, seasonRate: 90 },
    signals: [], concerns: [], marketUpdatedAt: '2026-10-04T11:58:00Z',
    marketMovement: { available: false, direction: 'unavailable', openingOdds: null, currentOdds: null,
      observedOverMinutes: null, pointCount: 0, label: null },
    outlierDependency: { available: true, sampleGames: 20, raw: { games: 20, total: 160, mean: 8 },
      withoutTopGame: { games: 19, total: 150, mean: 7.89 }, withoutTop2Games: { games: 18, total: 140, mean: 7.78 },
      explosiveDependencePercent: 6.25, median: 8, standardDeviation: 1.5 },
    volumeEfficiency: { available: true, basis: 'innings_pitched', estimatedVolume: 6,
      requiredRatePerUnit: 0.917, actualRatePerUnit: 1.333, meetsRequiredRate: true },
    alternateLineOptimizer: { available: false, side: 'over', options: [], recommended: null },
    crossBookThreshold: { available: true, standardLines: [{ line: 5.5, books: ['Fixture Book', 'Fixture Book 2', 'Fixture Book 3'] }],
      discrepancy: false, spread: 0 },
    howItLoses: ['An early exit reduces strikeout opportunities.'], sources: ['Synthetic MLB verification fixture'],
    mlbContext: syntheticContext(), matchupEvidenceAvailable: true,
    ...overrides,
  };
}

function finderSummary(): FinderRunSummary {
  return {
    results: [syntheticFinderResult({ id: 'mlb-judge-hits', player: 'Aaron Judge', playerId: 592450,
      marketLabel: 'Hits', marketKey: 'batter_hits', line: 0.5, projection: 1.8, projectionUncertainty: 0.6 }),
    syntheticFinderResult()],
    gamesAnalyzed: 1, gamesEligible: 1, gamesScheduled: 1, slateComplete: false,
    propsAnalyzed: 2, eventsMatched: 1, rawPropsTotal: 6, booksAnalyzed: 3,
    analyzedAt: now, slateDate, credits: null, fromCache: true, cacheAgeMs: 120000,
    budgetLimited: false, blockReason: null, oddsSpend: null,
  };
}

function seedResearchSession(): ResearchSession {
  const session = buildResearchSession({ sport: 'mlb', date: slateDate, queryIntent: query,
    results: finderSummary().results, toolMeta: { gamesFound: 1, gamesScheduled: 1, propsFound: 2,
      booksFound: 3, candidatesFound: 2, cached: true, dataFreshnessSeconds: 120, budgetLimited: false } });
  sessions.set('mlb-verification-session', session);
  return session;
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  vi.stubEnv('OPENAI_API_KEY', 'verification-only-key');
  vi.stubEnv('OPENAI_MODEL', 'gpt-4.1');
  vi.stubEnv('NODE_ENV', 'test');
  sessions.clear();
  getSessionMock.mockClear();
  saveSessionMock.mockClear();
  finderMock.mockReset();
  scheduleMock.mockReset();
  cachedPrimaryMarketsMock.mockReset();
  gameMarketsMock.mockReset();
  oddsEventsMock.mockReset();
  oddsEventsMock.mockResolvedValue([{ id: 'mlb-event-1', commenceTime: '2026-10-04T19:00:00Z',
    homeTeam: 'New York Yankees', awayTeam: 'Boston Red Sox' }]);
  gameMarketsMock.mockImplementation(async (events: OddsEvent[]) => {
    const reports = events.map(event => ({ event, status: 'complete', requestedMarkets: ['h2h'],
      missingMarkets: [], issues: [], quotes: parseMLBGameMarketOdds(event, {
        id: event.id, bookmakers: [{ key: 'fixture', title: 'Fixture Book', markets: [{ key: 'h2h',
          outcomes: [{ name: event.homeTeam, price: -110 }] }] }],
      }, ['h2h']).quotes }));
    return { events: reports, quotes: reports.flatMap(report => report.quotes) };
  });
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => {
    throw new Error('Unexpected network request in deterministic cached MLB verification');
  });
  vi.stubGlobal('fetch', fetchMock);
  scheduleMock.mockResolvedValue([{ id: 'mlb-game-1', date: slateDate,
    gameTime: '2026-10-04T19:00:00Z', status: 'Scheduled',
    homeTeam: { id: 147, name: 'New York Yankees', abbreviation: 'NYY' },
    awayTeam: { id: 111, name: 'Boston Red Sox', abbreviation: 'BOS' } }]);
  cachedPrimaryMarketsMock.mockResolvedValue(['pitcher_strikeouts', 'batter_hits']);
  finderMock.mockImplementation(async (date: string, options: { preflight?: boolean }) => {
    expect(date).toBe(slateDate);
    const summary = finderSummary();
    return options.preflight ? { ...summary, results: [], gamesAnalyzed: 0, propsAnalyzed: 0,
      validationPreflight: { eligibleGames: 1, matchedEvents: 1, selectedValidationGames: 1,
        cacheHits: 1, cacheMisses: 0, estimatedPaidSubRequests: 0, estimatedCreditCostLow: 0,
        estimatedCreditCostExpected: 0, estimatedCreditCostHigh: 0, preflightState: 'READY',
        paidRefreshAuthorized: false, games: [{ gameId: 'mlb-game-1', eventId: 'mlb-event-1',
          matchup: 'Boston Red Sox @ New York Yankees', gameTime: '2026-10-04T19:00:00Z',
          status: 'Scheduled', marketsCacheState: 'CACHE_FRESH', selected: true }] } } : summary;
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function post(content: string, researchSessionId: string | null = null) {
  return POST(new Request('http://localhost/api/ai/chat', { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content }], researchSessionId }) }));
}

describe('MLB POST verification with the actual agent runner and tools', () => {
  it('loads cached MLB preflight and Finder data, builds research, and ranks the matching player prop', async () => {
    const response = await post(query);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(finderMock.mock.calls).toEqual([
      [slateDate, { preflight: true, forceProviderRefresh: false }], [slateDate, { validationGameIds: ['mlb-game-1'] }],
    ]);
    expect(scheduleMock).toHaveBeenCalledExactlyOnceWith(slateDate);
    expect(cachedPrimaryMarketsMock).toHaveBeenCalledExactlyOnceWith('mlb-event-1');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getSessionMock).toHaveBeenCalledWith(null);
    expect(saveSessionMock).toHaveBeenCalledTimes(1);
    const saved = sessions.get('mlb-verification-session')!;
    expect(saved).toMatchObject({ sport: 'mlb', date: slateDate, queryIntent: query, generatedAt: now });
    expect(saved.candidates).toHaveLength(2);
    const record = saved.candidates.find(candidate => candidate.candidateId === 'mlb-cole-strikeouts')!;
    expect(record).toMatchObject({ playerId: 543037, teamId: 147, marketKey: 'pitcher_strikeouts',
      line: 5.5, direction: 'over', odds: -110, projection: 8, priceCurrent: true, valueQualified: true });
    expect(record.pickTier).not.toBe('PASS');
    expect(body.toolTrace.map((entry: { name: string; status: string }) => [entry.name, entry.status])).toEqual([
      ['rank_candidates', 'SUCCESS'],
    ]);
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toEqual(record);
    expect(body.meta).toMatchObject({ sport: 'mlb', date: slateDate, cached: true });
    expect(body.researchSessionId).toBe('mlb-verification-session');
    expect(body.ledgerReceipt).toBeNull();
    expect(body.meta).toMatchObject({ marketsEvaluated: 2, candidatesEvaluated: saved.candidates.length,
      rankedCandidates: body.meta.candidatesFound, researchComplete: true });
    expect(body.meta.qualifiedCandidates + body.meta.rejectedCandidates).toBe(body.meta.candidatesEvaluated);
  });

  it.each(['verification-only-key', ''])('reranks a stored MLB session with API key %j without model, Finder, storage, or provider requests', async (apiKey) => {
    vi.stubEnv('OPENAI_API_KEY', apiKey);
    const saved = seedResearchSession();
    const response = await post('Best 1 MLB pitcher strikeout props today', 'mlb-verification-session');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toEqual(saved.candidates.find(candidate => candidate.candidateId === 'mlb-cole-strikeouts'));
    expect(body.meta).toMatchObject({ sport: 'mlb', date: slateDate, reusedExistingSession: true });
    expect(body.toolTrace.map((entry: { name: string; status: string }) => [entry.name, entry.status])).toEqual([
      ['rank_candidates', 'SUCCESS'],
    ]);
    expect(getSessionMock).toHaveBeenCalledWith('mlb-verification-session');
    expect(finderMock).not.toHaveBeenCalled();
    expect(scheduleMock.mock.calls).toEqual([[slateDate]]);
    expect(cachedPrimaryMarketsMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(saveSessionMock).not.toHaveBeenCalled();
    expect(sessions.get('mlb-verification-session')).toEqual(saved);
  });

  it('returns explicit MLB moneyline quotes without qualified picks or substituting player props', async () => {
    seedResearchSession();
    const response = await post('Best MLB moneyline picks today', 'mlb-verification-session');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.results).toEqual([]);
    expect(body.closestMisses).toEqual([]);
    expect(body.mlbGameMarkets.events).toHaveLength(1);
    expect(body.mlbGameMarkets.quotes).toHaveLength(1);
    expect(body.mlbGameMarkets.quotes[0]).toMatchObject({ eventId: 'mlb-event-1', marketKey: 'h2h',
      modelProbability: null, edge: null, recommendation: false });
    expect(body.meta).toMatchObject({ sport: 'mlb', date: slateDate, status: 'UNMODELED_QUOTES',
      qualifiedCandidates: 0, researchComplete: false, quoteCoverageComplete: true });
    expect(body.reply).toMatch(/prices are available.*no validated MLB game-model probability or edge/i);
    expect(body.reply).toMatch(/not qualified picks/i);
    expect(body.reply).not.toMatch(/\bNFL\b/);
    expect(body.toolTrace).toEqual([]);
    expect(saveSessionMock).not.toHaveBeenCalled();
    expect(finderMock).not.toHaveBeenCalled();
    expect(scheduleMock).toHaveBeenCalledExactlyOnceWith(slateDate);
    expect(oddsEventsMock).toHaveBeenCalledExactlyOnceWith();
    expect(gameMarketsMock).toHaveBeenCalledExactlyOnceWith(await oddsEventsMock.mock.results[0].value);
    expect(cachedPrimaryMarketsMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reloads a stored MLB session when its quote is stale even on the same day', async () => {
    const saved = seedResearchSession();
    for (const candidate of saved.candidates) candidate.retrievedAt = '2026-10-04T10:00:00Z';
    const response = await post('Best 1 MLB pitcher strikeout props today', 'mlb-verification-session');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(finderMock).toHaveBeenCalledTimes(2);
    expect(scheduleMock).toHaveBeenCalledExactlyOnceWith(slateDate);
    expect(saveSessionMock).toHaveBeenCalledTimes(1);
    expect(body.meta?.reusedExistingSession).not.toBe(true);
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ candidateId: 'mlb-cole-strikeouts', retrievedAt: '2026-10-04T11:58:00Z' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not reuse stored MLB candidates after their game has started', async () => {
    seedResearchSession();
    vi.setSystemTime(new Date('2026-10-04T20:00:00Z'));
    scheduleMock.mockResolvedValue([{ id: 'mlb-game-1', date: slateDate,
      gameTime: '2026-10-04T19:00:00Z', status: 'In Progress',
      homeTeam: { id: 147, name: 'New York Yankees', abbreviation: 'NYY' },
      awayTeam: { id: 111, name: 'Boston Red Sox', abbreviation: 'BOS' } }]);
    const response = await post('Best 1 MLB pitcher strikeout props today', 'mlb-verification-session');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.results).toEqual([]);
    expect(body.meta).toMatchObject({ status: 'SLATE_COMPLETE' });
    expect(body.meta?.reusedExistingSession).not.toBe(true);
    expect(scheduleMock).toHaveBeenCalledExactlyOnceWith(slateDate);
    expect(finderMock).not.toHaveBeenCalled();
    expect(cachedPrimaryMarketsMock).not.toHaveBeenCalled();
    expect(oddsEventsMock).not.toHaveBeenCalled();
    expect(saveSessionMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not reuse a stored MLB candidate with an unknown game ID', async () => {
    const saved = seedResearchSession();
    for (const candidate of saved.candidates) candidate.gameId = 'unknown-game';
    const response = await post('Best 1 MLB pitcher strikeout props today', 'mlb-verification-session');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.meta?.reusedExistingSession).not.toBe(true);
    expect(finderMock).toHaveBeenCalledTimes(2);
    expect(scheduleMock).toHaveBeenCalledExactlyOnceWith(slateDate);
    expect(saveSessionMock).toHaveBeenCalledTimes(1);
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toMatchObject({ candidateId: 'mlb-cole-strikeouts', gameId: 'mlb-game-1' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});