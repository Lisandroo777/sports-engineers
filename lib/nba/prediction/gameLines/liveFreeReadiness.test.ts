import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { POST } from '../../../../app/api/ai/chat/route';
import type { toClientResult } from '../../../ai/agent/runner';
import type { ResearchCandidateRecord, ResearchSession } from '../../../ai/agent/session';
import { runNBAFinderDeepSearch, type NBAFinderSummary } from '../../../finder/nbaEngine';
import { issueNFLPresentationReceipt } from '../../../nfl/predictionLedger/capture';
import { createNBAContextProvider } from '../../context/provider';
import type { NBAContextSnapshot } from '../../context/types';
import { getNBASchedule } from '../../schedule';
import type { NBAGame } from '../../types';
import { availabilityDependencies, availabilityEvent, availabilityFixture, availabilityGame, availabilityTime } from './availability.fixtures';
import { researchNBAGameLines } from './pipeline';
import { classifyGameRecommendation } from './recommendations';
import { todaySlateDate } from '../../../dateModel';

const sessions = vi.hoisted(() => new Map<string, ResearchSession>());
vi.mock('../../../ai/agent/sessionStore', () => ({
  getResearchSession: vi.fn(async (id: string | null) => id ? structuredClone(sessions.get(id) ?? null) : null),
  saveResearchSession: vi.fn(async (session: ResearchSession) => {
    const id = `free-readiness-${sessions.size}`;
    sessions.set(id, structuredClone(session));
    return id;
  }),
  deleteResearchSession: vi.fn(async (id: string) => { sessions.delete(id); }),
}));
vi.mock('../../../finder/nbaEngine', () => ({ runNBAFinderDeepSearch: vi.fn() }));
vi.mock('../../../nfl/predictionLedger/capture', () => ({ issueNFLPresentationReceipt: vi.fn() }));

type Research = Awaited<ReturnType<typeof researchNBAGameLines>>;
type ChatResult = ReturnType<typeof toClientResult> & { ledgerReceipt: string | null };
type FetchEvidence = {
  url: string;
  startedAt: string;
  finishedAt: string | null;
  status: number | null;
  error: string | null;
};
const realFetch = globalThis.fetch;
let requests: FetchEvidence[];
let rejectedUrls: string[];

function summary(research: Research, date: string, gamesScheduled: number, live: boolean): NBAFinderSummary {
  return { results: [], nbaCandidates: [], gameCandidates: research.recommendations, modeledGames: research.modeledGames,
    gamesAnalyzed: research.modeledGames.length, gamesScheduled, propsAnalyzed: 0,
    booksAnalyzed: live ? 0 : 1, gamesEligible: research.modeledGames.length,
    slateComplete: false, eventsMatched: live ? 0 : 1, rawPropsTotal: 0,
    analyzedAt: new Date().toISOString(), slateDate: date, credits: null, blockReason: null, oddsSpend: null,
    fromCache: !live, cacheAgeMs: live ? null : 0, budgetLimited: false,
    playerMatching: { matched: 0, ambiguous: 0, unmatched: 0 },
    marketSupport: { full: 0, partial: 0, unsupported: 0 } };
}

async function chat(query: string, date: string, researchSessionId: string | null = null): Promise<ChatResult> {
  const response = await POST(new Request('http://localhost/api/ai/chat', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      messages: [{ role: 'user', content: query }], researchSessionId, context: { sport: 'nba', date },
    }) }));
  expect(response.status).toBe(200);
  const body = await response.json() as ChatResult;
  expect(body.meta).toMatchObject({ sport: 'nba', date, modelVersion: 'NBA_GAME_LINES_V1', validationStatus: 'UNVALIDATED' });
  expect(body.ledgerReceipt).toBeNull();
  return body;
}

function seededProp(): ResearchCandidateRecord {
  return { recommendationType: 'PLAYER_PROP', candidateId: 'value', rank: 0, playerId: 2, teamId: 1,
    player: 'Fixture Center', team: 'Home', opponent: 'Away', gameId: 'target',
    market: 'Points', marketKey: 'points', line: 20.5, direction: 'over', book: 'Fixture Book', odds: -110,
    availableBooks: 1, projection: 25, projectionUncertainty: 3, edge: 4.5,
    l5Rate: 80, l10Rate: 80, l20Rate: 80, seasonRate: 80, sampleSize: 20,
    researchScore: 90, dataQuality: 95, trueProbability: 65, evPercent: 10,
    trapRisk: 4, priceEdgePercent: 5, priceCurrent: true, priceFreshness: 'FRESH',
    valueQualified: true, isAlternate: false, eliteQualified: false,
    signalAgreement: 4, signalsAvailable: 4, evidenceCoverage: 100, qualification: 'STRONG', rejectionReasons: [],
    grade: 'B', priceGrade: 'B', playerEdgePercent: 5, breakEvenProbability: 52.38,
    projectedRange: null, bestAlternateLine: null, howItLoses: ['Minutes may fall.'], evidenceBoard: [],
    outlierDependencePercent: null, position: 'G', modelProbability: 65,
    historicalHitRate: 80, projectionReliability: 'HIGH', crossBookThreshold: null,
    marketMovement: null, outlierAnalysis: null, roleContext: { requirement: 'Verified role',
      status: 'STARTER', confidence: 'HIGH', workloadTrend: 'STABLE', reasons: [] },
    opponentContext: null, injuryContext: null, weatherContext: null,
    nbaPrediction: { reliability: 'HIGH', contextEvidence: [{ id: 'availability.current',
      kind: 'FACT', state: 'AVAILABLE', metric: 'reportedAvailability', value: 'AVAILABLE', units: null,
      detail: 'Fixture status', direction: 'NEUTRAL', directionBasis: null, markets: ['points'],
      reliability: 'MEDIUM', reliabilityReasons: [], sourceRefs: [], sample: null, missingReasons: [],
      dependencyIds: [], correlationGroup: 'availability' }] } as unknown as ResearchCandidateRecord['nbaPrediction'] };
}

beforeEach(() => {
  vi.clearAllMocks();
  sessions.clear();
  requests = [];
  rejectedUrls = [];
  vi.stubGlobal('fetch', vi.fn(async () => {
    rejectedUrls.push('Offline network attempt');
    throw new Error('All network requests forbidden in offline readiness tests');
  }));
});

afterEach(() => {
  try {
    expect(rejectedUrls).toEqual([]);
    expect(issueNFLPresentationReceipt).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it('OFFLINE: real POST/pipeline/models preserve mixed session discriminators and percentages, but never publish stale game quotes', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(availabilityTime));
  const date = '2026-01-21';
  const fixture = availabilityFixture('healthy');
  let research: Research | undefined;
  vi.mocked(runNBAFinderDeepSearch).mockImplementation(async requestedDate => {
    research = await researchNBAGameLines([availabilityGame()], [availabilityEvent()], availabilityDependencies(fixture));
    return summary(research, requestedDate ?? '2026-01-21', 1, false);
  });
  const first = await chat('Give me NBA moneylines', date);
  expect(research!.recommendations).toHaveLength(1);
  const game = research!.recommendations[0];
  expect(game).toMatchObject({ pickTier: 'EDGE', availabilityVerified: true, assessment: { status: 'PRICED' },
    projection: { status: 'AVAILABLE' }, availability: { impactReviewResolved: true, startingLineupsVerified: true } });
  expect(first.results).toHaveLength(1);
  expect(first.modeledGames).toEqual(research!.modeledGames);
  const query = 'Find the best NBA player props and game lines for today.';
  const prop = seededProp();
  const saved = sessions.get(first.researchSessionId!)!;
  saved.queryIntent = query;
  saved.candidates = [prop];
  const beforePublication = structuredClone(saved);
  const mixed = await chat(query, date, first.researchSessionId);
  expect(mixed.researchSessionId).toBe(first.researchSessionId);
  expect(mixed.results).toHaveLength(2);
  expect(mixed.results).toEqual(expect.arrayContaining([
    expect.objectContaining({ recommendationType: 'GAME', candidateId: game.candidateId,
      trueProbability: game.assessment.conditionalWinProbability! * 100, evPercent: game.evPercent, quote: game.quote }),
    expect.objectContaining({ recommendationType: 'PLAYER_PROP', candidateId: prop.candidateId,
      trueProbability: 65, modelProbability: 65, historicalHitRate: 80 }),
  ]));
  expect(game.trueProbability).toBeGreaterThan(1);
  expect(game.trueProbability).toBeLessThanOrEqual(100);
  expect(game).toMatchObject({ home: { name: expect.any(String) }, away: { name: expect.any(String) },
    quote: { sportsbook: expect.any(String), americanOdds: expect.any(Number), updatedAt: expect.any(String), observedAt: expect.any(String) },
    assessment: { conditionalWinProbability: expect.any(Number), evPercent: expect.any(Number) },
    projection: { phase: 'REGULAR', means: { margin: expect.any(Number) } }, evidence: expect.any(Array) });
  expect(prop).toMatchObject({ team: expect.any(String), market: 'Points', book: 'Fixture Book', odds: -110,
    edge: 4.5, trueProbability: 65, nbaPrediction: { contextEvidence: expect.any(Array) } });
  const publishedGame = mixed.results.find(row => (row as { recommendationType: string }).recommendationType === 'GAME');
  expect(publishedGame).not.toHaveProperty('player');
  expect(publishedGame).not.toHaveProperty('playerId');
  expect(sessions.get(first.researchSessionId!)).toEqual(beforePublication);
  vi.setSystemTime(new Date('2026-01-21T18:40:00Z'));
  expect(Date.now()).toBeLessThan(Date.parse(game.availability!.expiresAt!));
  expect(Date.now() - Date.parse(game.quote.updatedAt)).toBeGreaterThan(3600000);
  expect(classifyGameRecommendation(game).pickTier).toBe('PASS');
  const stale = await chat(query, date, first.researchSessionId);
  expect(stale.results).toEqual([expect.objectContaining({ recommendationType: 'PLAYER_PROP', candidateId: 'value', trueProbability: 65 })]);
  expect(stale.closestMisses).toEqual([]);
  expect(stale.modeledGames).toEqual(first.modeledGames);
  expect(sessions.get(first.researchSessionId!)).toEqual(beforePublication);
  expect(runNBAFinderDeepSearch).toHaveBeenCalledExactlyOnceWith(date, { gameLines: true, gameLinesOnly: true });
  expect(fetch).not.toHaveBeenCalled();
});

it('OFFLINE: the exact today query returns an explicit no-qualified-picks result when verified evidence is missing', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(availabilityTime));
  const fixture = availabilityFixture('missing');
  vi.mocked(runNBAFinderDeepSearch).mockImplementation(async requestedDate => {
    const research = await researchNBAGameLines([availabilityGame()], [availabilityEvent()], availabilityDependencies(fixture));
    return summary(research, requestedDate ?? '2026-01-21', 1, false);
  });
  const result = await chat('Find the best NBA player props and game lines for today.', '2026-01-21');
  expect(runNBAFinderDeepSearch).toHaveBeenCalledExactlyOnceWith('2026-01-21', { gameLines: true, gameLinesOnly: false });
  expect(result.results).toEqual([]);
  expect(result.reply).toMatch(/No NBA selections passed.*publication requirements/i);
  expect(result.modeledGames?.[0].availability?.blockers.join(' ')).toMatch(/official target-game injury report missing/);
  expect(fetch).not.toHaveBeenCalled();
});

it.skipIf(process.env.NBA_FREE_READINESS !== '1')('LIVE FREE: real POST/runner/pipeline and bounded ESPN context report actual readiness without quotes or official lineups', async context => {
  vi.useRealTimers();
  const startedAt = new Date().toISOString();
  const date = todaySlateDate();
  const scheduleEvidence: Array<{ date: string; games: number; upcoming: number; error: string | null }> = [];
  let selected: NBAGame | null = null;
  let selectedDate: string | null = null;
  let snapshot: NBAContextSnapshot | null = null;
  let contextError: string | null = null;
  let research: Research = { recommendations: [], modeledGames: [] };
  const provider = createNBAContextProvider({ maxRequests: 10, maxGamesPerTeam: 1,
    fetcher: (input, init) => fetch(input, init) });
  const loadQuotes = vi.fn(async () => ({ status: 'UNSUPPORTED_QUOTE' as const, quotes: [], reason: 'No quote: free readiness only.' }));
  const loadIntelligence = vi.fn(async () => null);
  vi.stubGlobal('fetch', vi.fn(async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== 'https://site.api.espn.com' || !url.pathname.startsWith('/apis/site/v2/sports/basketball/nba/')
      || url.username || url.password) {
      rejectedUrls.push(url.toString());
      throw new Error('Only free ESPN NBA site endpoints are permitted');
    }
    const evidence: FetchEvidence = { url: url.toString(), startedAt: new Date().toISOString(), finishedAt: null, status: null, error: null };
    requests.push(evidence);
    try {
      const existingSignal = init?.signal ?? (input instanceof Request ? input.signal : null);
      const timeout = AbortSignal.timeout(10000);
      const response = await realFetch(input, { ...init, redirect: 'error',
        signal: existingSignal ? AbortSignal.any([existingSignal, timeout]) : timeout });
      evidence.status = response.status;
      return response;
    } catch (error) {
      evidence.error = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown fetch failure';
      throw error;
    } finally {
      evidence.finishedAt = new Date().toISOString();
    }
  }));
  vi.mocked(runNBAFinderDeepSearch).mockImplementation(async requestedDate => {
    for (const candidateDate of [date]) {
      try {
        const games = await getNBASchedule(candidateDate);
        const upcoming = games.filter(game => !game.completed && Date.parse(game.gameTime) > Date.now());
        scheduleEvidence.push({ date: candidateDate, games: games.length, upcoming: upcoming.length, error: null });
        if (upcoming.length) { selected = upcoming[0]; selectedDate = candidateDate; break; }
      } catch (error) {
        scheduleEvidence.push({ date: candidateDate, games: 0, upcoming: 0,
          error: error instanceof Error ? error.message : 'Schedule unavailable' });
      }
    }
    research = await researchNBAGameLines(selected ? [selected] : [], [], {
      loadSnapshot: async (gameId, teamId) => {
        try {
          snapshot = await provider.loadSnapshot({ gameId, teamId });
          return snapshot;
        } catch (error) {
          contextError = error instanceof Error ? error.message : 'Context unavailable';
          throw error;
        }
      },
      loadQuotes, loadIntelligence,
    });
    return summary(research, requestedDate ?? new Date().toISOString().slice(0, 10), scheduleEvidence.at(-1)?.games ?? 0, true);
  });
  let result: ChatResult | undefined;
  try {
    result = await chat('Find the best NBA player props and game lines for today.', date);
    expect(runNBAFinderDeepSearch).toHaveBeenCalledExactlyOnceWith(date, { gameLines: true, gameLinesOnly: false });
    expect(scheduleEvidence.length).toBe(1);
    expect(requests.filter(request => new URL(request.url).pathname.endsWith('/scoreboard'))).toHaveLength(scheduleEvidence.length);
    expect(provider.requestsUsed()).toBeLessThanOrEqual(10);
    expect(requests.length).toBe(scheduleEvidence.length + provider.requestsUsed());
    expect(rejectedUrls).toEqual([]);
    expect(loadQuotes).not.toHaveBeenCalled();
    expect(research.recommendations).toEqual([]);
    expect(result.results).toEqual([]);
    expect(result.closestMisses).toEqual([]);
    expect(result.modeledGames).toEqual(research.modeledGames);
    expect(result.reply).toContain('not a betting recommendation');
    expect(sessions.get(result.researchSessionId!)).toMatchObject({ sport: 'nba', candidates: [], gameCandidates: [], modeledGames: research.modeledGames });
    if (!selected) {
      expect(research.modeledGames).toEqual([]);
      expect(result.reply).toMatch(/No NBA selections passed/);
      return;
    }
    const game: NBAGame = selected;
    expect(game.completed).toBe(false);
    expect(Date.parse(game.gameTime)).toBeGreaterThan(Date.parse(startedAt));
    expect(research.modeledGames).toHaveLength(1);
    const modeled = research.modeledGames[0];
    expect(modeled).toMatchObject({ recommendationType: 'GAME', gameId: game.id,
      home: { id: game.homeTeam.id, name: game.homeTeam.displayName },
      away: { id: game.awayTeam.id, name: game.awayTeam.displayName } });
    if (!snapshot) {
      expect(modeled).toMatchObject({ status: 'RESEARCH_UNAVAILABLE', projection: null });
      expect(contextError).not.toBeNull();
      context.skip('FREE_CONTEXT_UNAVAILABLE: actual game found but free summary/context unavailable; see evidence.');
      return;
    }
    const observed: NBAContextSnapshot = snapshot;
    expect(observed.target.gameId).toBe(game.id);
    expect(observed.target.homeTeamId).toBe(game.homeTeam.id);
    expect(observed.target.awayTeamId).toBe(game.awayTeam.id);
    expect(Date.parse(observed.target.startsAt)).toBe(Date.parse(game.gameTime));
    expect(Date.parse(observed.target.source.fetchedAt)).toBeLessThanOrEqual(Date.parse(observed.asOf));
    expect(loadIntelligence).toHaveBeenCalledExactlyOnceWith(observed);
    expect(modeled.availability).toMatchObject({ startingLineupsVerified: false, injuriesVerified: false, impactReviewResolved: false });
    expect(modeled.availability!.teams.every(team => team.confirmedStarterIds.length === 0)).toBe(true);
    expect(modeled.availability!.blockers.join(' ')).toMatch(/no fresh officially confirmed starting five/i);
    expect(modeled.projection).toMatchObject({ gameId: game.id, phase: observed.target.phase,
      predictionAt: observed.asOf, modelVersion: 'NBA_GAME_LINES_V1', validationStatus: 'UNVALIDATED' });
    expect(modeled.status).toBe(modeled.projection!.status === 'AVAILABLE' ? 'MODELED_NOT_BETTABLE' : 'RESEARCH_UNAVAILABLE');
    if (observed.target.phase === 'PRESEASON' || observed.target.phase === 'UNKNOWN') {
      expect(modeled.status).toBe('RESEARCH_UNAVAILABLE');
      expect(modeled.projection!.status).toBe('UNSUPPORTED_PHASE');
      expect(modeled.projection!.means).toBeNull();
      expect(modeled.projection!.homeWinProbability).toBeNull();
    }
  } finally {
    const observed = snapshot as NBAContextSnapshot | null;
    const game = selected as NBAGame | null;
    console.info('NBA_FREE_READINESS', JSON.stringify({
      startedAt, finishedAt: new Date().toISOString(), requestedDate: date, selectedDate,
      readiness: !game ? 'FREE_DATA_UNAVAILABLE' : !observed ? 'FREE_CONTEXT_UNAVAILABLE' : 'NOT_BETTABLE_NO_QUOTES_OR_OFFICIAL_LINEUPS',
      scheduleEvidence, scheduleCalls: scheduleEvidence.length, contextRequests: provider.requestsUsed(),
      totalRequests: requests.length, successfulResponses: requests.filter(request => request.status === 200).length,
      rejectedUrls, requests, game: game ? { id: game.id, startsAt: game.gameTime,
        home: game.homeTeam.displayName, away: game.awayTeam.displayName, schedulePhase: game.phase } : null,
      source: observed?.target.source ?? null, phase: observed?.target.phase ?? null,
      asOf: observed?.asOf ?? null, historicalGames: observed?.games.length ?? null,
      missing: observed?.missing ?? [], contextError,
      modeledGames: research.modeledGames.map(modeled => ({ gameId: modeled.gameId, status: modeled.status,
        projectionStatus: modeled.projection?.status ?? null, reason: modeled.reason,
        phaseEvidence: modeled.availability?.phase ?? null, blockers: modeled.availability?.blockers ?? [],
        risks: modeled.projection?.risks ?? [] })),
      publishedRecommendations: result?.results.length ?? null, quoteLoaderCalls: loadQuotes.mock.calls.length,
    }, null, 2));
  }
}, 90000);