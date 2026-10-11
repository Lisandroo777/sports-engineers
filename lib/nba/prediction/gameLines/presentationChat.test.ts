import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../../../app/api/ai/chat/route';
import type { toClientResult } from '../../../ai/agent/runner';
import type { ResearchCandidateRecord, ResearchSession } from '../../../ai/agent/session';
import { getResearchSession, saveResearchSession } from '../../../ai/agent/sessionStore';
import { runNBAFinderDeepSearch, type NBACandidate, type NBAFinderSummary } from '../../../finder/nbaEngine';
import { availabilityDependencies, availabilityEvent, availabilityFixture, availabilityGame, availabilityTime,
  type AvailabilityScenario } from './availability.fixtures';
import { quote } from './fixtures';
import { researchNBAGameLines } from './pipeline';
import type { NBARecommendation } from './recommendations';

const sessions = vi.hoisted(() => new Map<string, ResearchSession>());
vi.mock('../../../ai/agent/sessionStore', () => ({
  getResearchSession: vi.fn(async (id: string | null) => id ? structuredClone(sessions.get(id) ?? null) : null),
  saveResearchSession: vi.fn(async (session: ResearchSession) => {
    const id = `presentation-session-${sessions.size}`;
    sessions.set(id, structuredClone(session));
    return id;
  }),
  deleteResearchSession: vi.fn(async (id: string) => { sessions.delete(id); }),
}));
vi.mock('../../../finder/nbaEngine', () => ({ runNBAFinderDeepSearch: vi.fn() }));

const date = '2026-01-21';
let scenario: AvailabilityScenario;
let missingQuotes: boolean;
let rawProps: NBACandidate[];
let research: Awaited<ReturnType<typeof researchNBAGameLines>>;

async function finderWrapper(requestedDate = date): Promise<NBAFinderSummary> {
  const fixture = availabilityFixture(scenario);
  const dependencies = availabilityDependencies(fixture, quote({ market: 'MONEYLINE', selection: 'HOME', team: 'HOME', line: null }));
  if (missingQuotes) dependencies.loadQuotes = async () => ({ status: 'UNSUPPORTED_QUOTE', quotes: [], reason: 'Offline cache empty' });
  research = await researchNBAGameLines([availabilityGame()], [availabilityEvent()], dependencies);
  return { results: [], nbaCandidates: rawProps, gameCandidates: research.recommendations, modeledGames: research.modeledGames,
    gamesAnalyzed: 1, gamesScheduled: 1, propsAnalyzed: rawProps.length, booksAnalyzed: 1, gamesEligible: 1,
    slateComplete: false, eventsMatched: 1, rawPropsTotal: rawProps.length, analyzedAt: availabilityTime, slateDate: requestedDate,
    credits: null, blockReason: null, oddsSpend: null, fromCache: true, cacheAgeMs: 0, budgetLimited: false,
    playerMatching: { matched: 0, ambiguous: 0, unmatched: rawProps.length },
    marketSupport: { full: 0, partial: 0, unsupported: rawProps.length } };
}

function savedProp(overrides: Partial<ResearchCandidateRecord> = {}): ResearchCandidateRecord {
  return { recommendationType: 'PLAYER_PROP', candidateId: 'saved-prop', rank: 1, playerId: 101, teamId: 1,
    player: 'Fixture Player 101', team: 'Home', opponent: 'Away', gameId: 'target', market: 'Points', marketKey: 'player_points',
    line: 24.5, direction: 'over', book: 'Fixture Book', odds: -110, availableBooks: 1,
    projection: 28, projectionUncertainty: 3, edge: 3.5, l5Rate: 60, l10Rate: 60, l20Rate: 60, seasonRate: 60,
    researchScore: 74, signalAgreement: 4, signalsAvailable: 6, evidenceCoverage: 95, priceFreshness: 'FRESH',
    trueProbability: 60, evPercent: 14.545454545454541, isAlternate: false, dataQuality: 95, trapRisk: 10,
    qualification: 'WATCH', eliteQualified: false, rejectionReasons: [], grade: 'A', priceGrade: 'A',
    playerEdgePercent: 14, priceEdgePercent: 7.619047619047613, breakEvenProbability: 52.38095238095239,
    projectedRange: null, bestAlternateLine: null, howItLoses: ['Minutes could fall.'], evidenceBoard: [],
    outlierDependencePercent: null, position: 'G', modelProbability: 62, historicalHitRate: 60, sampleSize: 10,
    projectionReliability: 'HIGH', priceCurrent: true, valueQualified: true, crossBookThreshold: null, marketMovement: null,
    outlierAnalysis: null, roleContext: null, opponentContext: null, injuryContext: { status: 'AVAILABLE' }, weatherContext: null,
    retrievedAt: availabilityTime, pickTier: 'NUKE', tierScore: 100, ...overrides };
}

function rawProp(): NBACandidate {
  return { sport: 'nba', id: 'raw-prop', eventId: 'odds-1', gameId: 'target', playerId: null, playerName: 'Unknown Player',
    playerMatch: 'UNMATCHED', team: 'Home', opponent: 'Away', market: 'points', marketLabel: 'Points',
    historicalSupport: 'unsupported', line: 20.5, side: 'over', book: 'Fixture Book', oddsAmerican: -110, isAlternate: false,
    priceTimestamp: availabilityTime, priceFreshness: 'FRESH', history: null, projection: null, injuryTier: null,
    injuryEvidence: 'FEED_UNAVAILABLE', nbaPrediction: null, researchContext: null, intelligenceSnapshot: null,
    outlierDependency: null, alternateLines: null, crossBookThreshold: null,
    marketMovement: { available: false, direction: 'unavailable', openingOdds: null, currentOdds: null,
      observedOverMinutes: null, pointCount: 0, label: null },
    howItLoses: [], position: null, opponentContext: null, eliteAnalysis: null };
}

async function chat(query: string, researchSessionId: string | null = null, contextDate = date) {
  const response = await POST(new Request('http://localhost/api/ai/chat', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      messages: [{ role: 'user', content: query }], researchSessionId, context: { sport: 'nba', date: contextDate },
    }) }));
  expect(response.status).toBe(200);
  const result = await response.json() as Omit<ReturnType<typeof toClientResult>, 'results'>
    & { results: NBARecommendation[]; ledgerReceipt: string | null };
  expect(result.nbaPresentation).toBeDefined();
  expect(result.ledgerReceipt).toBeNull();
  expect(result.meta).toMatchObject({ sport: 'nba', modelVersion: 'NBA_GAME_LINES_V1', validationStatus: 'UNVALIDATED' });
  return result;
}

function expectRecommendationIds(result: Awaited<ReturnType<typeof chat>>) {
  const presentation = result.nbaPresentation!;
  const ids = result.results.map(record => record.candidateId);
  expect(presentation.recommendedCandidateIds).toEqual(ids);
  expect(new Set(presentation.recommendations.map(pick => pick.candidateId))).toEqual(new Set(ids));
  expect(presentation.recommendations.every(pick => pick.tierDecision?.pickTier !== 'PASS')).toBe(true);
  expect(presentation.researchedCandidates.map(pick => pick.candidateId))
    .toEqual(presentation.picks.filter(pick => !ids.includes(pick.candidateId)).map(pick => pick.candidateId));
}

beforeEach(() => {
  vi.clearAllMocks();
  sessions.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(availabilityTime));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('All network and paid provider calls forbidden in presentation POST tests'); }));
  scenario = 'healthy';
  missingQuotes = false;
  rawProps = [];
  vi.mocked(runNBAFinderDeepSearch).mockImplementation(finderWrapper);
});

afterEach(() => {
  try { expect(fetch).not.toHaveBeenCalled(); }
  finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
});

describe('NBA presentation through actual POST and real runner, backend only', () => {
  it('serializes fresh EDGE game cards with exact source odds, probability and EV', async () => {
    const result = await chat('Give me NBA moneylines');
    expect(runNBAFinderDeepSearch).toHaveBeenCalledExactlyOnceWith(date, { gameLines: true, gameLinesOnly: true });
    expect(getResearchSession).toHaveBeenCalledExactlyOnceWith(null);
    expect(saveResearchSession).toHaveBeenCalledTimes(1);
    expect(result.results).toHaveLength(1);
    const record = research.recommendations[0];
    expect(record.pickTier).toBe('EDGE');
    expect(result.nbaPresentation).toMatchObject({ schemaVersion: 'deepside-nba-pick-presentation/1',
      outcome: 'PICKS_AVAILABLE', requestedSort: 'BEST', sortStatus: 'UPSTREAM_ORDER', researchedCandidates: [] });
    expect(result.nbaPresentation!.picks).toHaveLength(1);
    expect(result.nbaPresentation!.picks[0]).toMatchObject({ candidateId: record.candidateId,
      subject: { kind: 'GAME_LINE', gameId: 'target', market: { type: 'MONEYLINE', line: null, selection: 'HOME' } },
      tierDecision: { pickTier: 'EDGE', tierScore: 75 }, disposition: 'RECOMMENDED',
      pricing: { state: 'PRICED', sportsbook: record.quote.sportsbook, americanOdds: record.quote.americanOdds, quoteStatus: 'CURRENT' },
      metrics: { trueProbability: record.trueProbability, modelProbability: record.trueProbability, evPercent: record.evPercent, researchScore: 75 } });
    expectRecommendationIds(result);
  });

  it.each(['projected', 'questionable', 'stale', 'missing', 'restriction', 'meaningfulOUT'] as const)
    ('includes actual %s PASS cards in full research but never in recommendation IDs', async variant => {
      scenario = variant;
      const result = await chat('Give me NBA moneylines');
      expect(result.results).toEqual([]);
      expect(research.recommendations).toHaveLength(1);
      const record = research.recommendations[0];
      expect(record.pickTier).toBe('PASS');
      expect(result.nbaPresentation).toMatchObject({ outcome: 'NO_QUALIFIED_PICKS', recommendations: [], recommendedCandidateIds: [] });
      expect(result.nbaPresentation!.picks).toHaveLength(1);
      expect(result.nbaPresentation!.picks[0]).toMatchObject({ candidateId: record.candidateId, disposition: 'PASS',
        tierDecision: { pickTier: 'PASS' }, metrics: { trueProbability: record.trueProbability, evPercent: record.evPercent,
          researchScore: record.researchScore }, pricing: { americanOdds: record.quote.americanOdds } });
      expect(result.nbaPresentation!.researchedCandidates).toEqual(result.nbaPresentation!.picks);
      expect(result.nbaPresentation!.picks[0].researchEvidence.map(entry => entry.detail).join(' '))
        .toContain(record.availability!.blockers[0]);
      expectRecommendationIds(result);
    });

  it('publishes both subject kinds while keeping raw props research-only on a fresh mixed search', async () => {
    rawProps = [rawProp()];
    const result = await chat('Give me NBA props and moneylines');
    expect(runNBAFinderDeepSearch).toHaveBeenCalledExactlyOnceWith(date, { gameLines: true, gameLinesOnly: false });
    expect(result.nbaPresentation!.picks).toHaveLength(2);
    expect(new Set(result.nbaPresentation!.picks.map(pick => pick.subject.kind))).toEqual(new Set(['GAME_LINE', 'PLAYER_PROP']));
    expect(result.nbaPresentation!.researchedCandidates[0]).toMatchObject({ candidateId: 'raw-prop',
      disposition: 'RESEARCH_ONLY', tierDecision: null, subject: { kind: 'PLAYER_PROP' },
      metrics: { trueProbability: null, modelProbability: null, evPercent: null, researchScore: null, tierScore: null } });
    expect(result.results).toHaveLength(1);
    expectRecommendationIds(result);
  });

  it('reclassifies saved NUKE labels to real LEAN and PASS, returning both qualified kinds without Finder', async () => {
    const query = 'Give me NBA props and moneylines';
    const initial = await chat(query);
    const saved = sessions.get(initial.researchSessionId!)!;
    saved.candidates = [savedProp(), savedProp({ candidateId: 'blocked-prop', sampleSize: 4 })];
    const snapshot = structuredClone(saved);
    vi.mocked(runNBAFinderDeepSearch).mockClear();
    const result = await chat(query, initial.researchSessionId);
    expect(runNBAFinderDeepSearch).not.toHaveBeenCalled();
    expect(result.results.map(record => record.candidateId)).toEqual([research.recommendations[0].candidateId, 'saved-prop']);
    expect(result.nbaPresentation!.recommendations.map(pick => pick.subject.kind)).toEqual(['GAME_LINE', 'PLAYER_PROP']);
    expect(result.nbaPresentation!.recommendations[1]).toMatchObject({ candidateId: 'saved-prop', disposition: 'LEAN',
      tierDecision: { pickTier: 'LEAN', tierScore: 74 }, pricing: { americanOdds: -110 },
      metrics: { trueProbability: 60, modelProbability: 62, evPercent: 14.545454545454541, researchScore: 74 } });
    expect(result.nbaPresentation!.researchedCandidates).toHaveLength(1);
    expect(result.nbaPresentation!.researchedCandidates[0]).toMatchObject({ candidateId: 'blocked-prop', disposition: 'PASS',
      tierDecision: { pickTier: 'PASS' } });
    expect(sessions.get(initial.researchSessionId!)).toEqual(snapshot);
    expectRecommendationIds(result);
  });

  it('keeps unquoted models research-only with null odds, probabilities, EV and score', async () => {
    missingQuotes = true;
    const result = await chat('Give me NBA moneylines');
    expect(result.results).toEqual([]);
    expect(result.nbaPresentation).toMatchObject({ outcome: 'RESEARCH_ONLY', recommendations: [], recommendedCandidateIds: [] });
    expect(result.nbaPresentation!.picks).toHaveLength(1);
    expect(result.nbaPresentation!.picks[0]).toMatchObject({ disposition: 'RESEARCH_ONLY', tierDecision: null,
      pricing: { state: 'UNPRICED', sportsbook: null, americanOdds: null },
      metrics: { trueProbability: null, modelProbability: null, evPercent: null, researchScore: null, tierScore: null } });
    expectRecommendationIds(result);
  });

  it('does not substitute a saved prior slate for an explicit today request, even with prior-date context', async () => {
    const first = await chat('Give me NBA moneylines');
    const prior = sessions.get(first.researchSessionId!)!;
    prior.date = '2026-01-20';
    const snapshot = structuredClone(prior);
    vi.mocked(runNBAFinderDeepSearch).mockClear();
    missingQuotes = true;
    const result = await chat('Give me NBA moneylines today', first.researchSessionId, '2026-01-20');
    expect(runNBAFinderDeepSearch).toHaveBeenCalledExactlyOnceWith(date, { gameLines: true, gameLinesOnly: true });
    expect(result.meta?.date).toBe(date);
    expect(result.researchSessionId).not.toBe(first.researchSessionId);
    expect(result.results).toEqual([]);
    expect(result.nbaPresentation!.outcome).toBe('RESEARCH_ONLY');
    expect(result.nbaPresentation!.picks.some(pick => pick.candidateId === snapshot.gameCandidates![0].candidateId)).toBe(false);
    expect(sessions.get(first.researchSessionId!)).toEqual(snapshot);
    expectRecommendationIds(result);
  });

  it('strips cached stale odds and model betting metrics on POST followup without a paid refresh', async () => {
    const first = await chat('Give me NBA moneylines');
    const snapshot = structuredClone(sessions.get(first.researchSessionId!)!);
    vi.setSystemTime(new Date('2026-01-21T20:00:00Z'));
    const result = await chat('Give me NBA moneylines', first.researchSessionId);
    expect(runNBAFinderDeepSearch).toHaveBeenCalledTimes(1);
    expect(result.results).toEqual([]);
    expect(result.nbaPresentation!.picks[0]).toMatchObject({ disposition: 'PASS', tierDecision: { pickTier: 'PASS' },
      pricing: { state: 'UNPRICED', americanOdds: null, sportsbook: null, quoteStatus: 'STALE' },
      metrics: { trueProbability: null, modelProbability: null, evPercent: null, researchScore: null } });
    expect(sessions.get(first.researchSessionId!)).toEqual(snapshot);
    expectRecommendationIds(result);
  });
});