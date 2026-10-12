import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinderResult, FinderRunSummary } from '../../finder/engine';
import type { ResearchCandidateRecord, ResearchSession } from './session';

const { finderMock, sessions, getSessionMock, saveSessionMock } = vi.hoisted(() => {
  const sessions = new Map<string, ResearchSession>();
  return {
    sessions,
    finderMock: vi.fn(),
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
}));
vi.mock('./sessionStore', () => ({
  getResearchSession: getSessionMock,
  saveResearchSession: saveSessionMock,
  deleteResearchSession: vi.fn(),
}));

import { POST } from '../../../app/api/ai/chat/route';
import { buildResearchSession } from './session';

const slateDate = '2026-10-04';
const now = '2026-10-04T12:00:00.000Z';
const query = 'Find me the best MLB pitcher strikeout props today';

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

function functionCall(name: string, args: Record<string, unknown>) {
  return { output: [{ type: 'function_call', call_id: `call-${name}`, name, arguments: JSON.stringify(args) }] };
}

const fetchMock = vi.fn();
let openAIQueue: unknown[];

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
  fetchMock.mockReset();
  openAIQueue = [];
  fetchMock.mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer verification-only-key' });
    expect(openAIQueue.length, 'Unexpected OpenAI call or exhausted response queue').toBeGreaterThan(0);
    return Response.json(openAIQueue.shift());
  });
  vi.stubGlobal('fetch', fetchMock);
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
    openAIQueue = [
      functionCall('get_sportsbook_candidates', { sport: 'nba', date: '2026-01-01' }),
      functionCall('rank_candidates', { marketContains: 'strikeout', maxResults: 1 }),
      { output: [{ type: 'message', content: [{ type: 'output_text', text: 'Research complete.' }] }] },
    ];
    const response = await post(query);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(finderMock.mock.calls).toEqual([
      [slateDate, { preflight: true, forceProviderRefresh: false }], [slateDate, {}],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(openAIQueue).toEqual([]);
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
      ['get_sportsbook_candidates', 'SUCCESS'], ['rank_candidates', 'SUCCESS'],
    ]);
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toEqual(record);
    expect(body.meta).toMatchObject({ sport: 'mlb', date: slateDate, cached: true });
    expect(body.researchSessionId).toBe('mlb-verification-session');
    expect(body.ledgerReceipt).toBeNull();
    const finalRequest = JSON.parse(fetchMock.mock.calls[2][1].body as string);
    const outputs = finalRequest.input.filter((entry: { type?: string }) => entry.type === 'function_call_output')
      .map((entry: { output: string }) => JSON.parse(entry.output));
    expect(outputs).toHaveLength(2);
    expect(outputs[0]).toMatchObject({ status: 'SUCCESS', sport: 'mlb', date: slateDate,
      data: { loaded: true, candidatesFound: 2 } });
    expect(outputs[1].data.results.map((candidate: ResearchCandidateRecord) => candidate.candidateId)).toEqual(['mlb-cole-strikeouts']);
  });

  it('reranks a stored MLB session with a key but no model, Finder, or provider requests', async () => {
    const saved = seedResearchSession();
    const response = await post('Best 1 MLB pitcher strikeout props today', 'mlb-verification-session');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0]).toEqual(saved.candidates.find(candidate => candidate.candidateId === 'mlb-cole-strikeouts'));
    expect(body.meta).toMatchObject({ sport: 'mlb', date: slateDate, reusedExistingSession: true });
    expect(body.toolTrace.map((entry: { name: string }) => entry.name)).toEqual(['get_last_research_session', 'rank_candidates']);
    expect(getSessionMock).toHaveBeenCalledWith('mlb-verification-session');
    expect(finderMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(saveSessionMock).not.toHaveBeenCalled();
  });

  it('requires an API key even when MLB cached ranking could otherwise answer', async () => {
    seedResearchSession();
    vi.stubEnv('OPENAI_API_KEY', '');
    const response = await post('Best MLB pitcher strikeout props today', 'mlb-verification-session');
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'AI_UNAVAILABLE' });
    expect(finderMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('honestly rejects explicit MLB moneyline requests without substituting player props or NFL support', async () => {
    seedResearchSession();
    const response = await post('Best MLB moneyline picks today', 'mlb-verification-session');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.results).toEqual([]);
    expect(body.reply).toMatch(/cannot supply a verified pick/i);
    expect(body.reply).not.toMatch(/\bNFL\b/);
    expect(finderMock).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});