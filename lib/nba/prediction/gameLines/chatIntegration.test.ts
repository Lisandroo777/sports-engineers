import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../../../app/api/ai/chat/route';
import type { AgentTurnResult } from '../../../ai/agent/runner';
import type { ResearchCandidateRecord, ResearchSession } from '../../../ai/agent/session';
import { runNBAFinderDeepSearch, type NBAFinderSummary } from '../../../finder/nbaEngine';
import { issueNFLPresentationReceipt } from '../../../nfl/predictionLedger/capture';
import { binding, historicalFixture, quote } from './fixtures';
import { projectNBAGame } from './model';
import { buildGameRecommendation, withoutScenarios, type GameRecommendation, type ModeledGameResearch } from './recommendations';
import type { GameQuote } from './types';

const sessions = vi.hoisted(() => new Map<string, ResearchSession>());
vi.mock('../../../ai/agent/sessionStore', () => ({
  getResearchSession: vi.fn(async (id: string | null) => id ? structuredClone(sessions.get(id) ?? null) : null),
  saveResearchSession: vi.fn(async (session: ResearchSession) => {
    const id = `nba-session-${sessions.size}`;
    sessions.set(id, structuredClone(session));
    return id;
  }),
  deleteResearchSession: vi.fn(async (id: string) => { sessions.delete(id); }),
}));
vi.mock('../../../finder/nbaEngine', () => ({ runNBAFinderDeepSearch: vi.fn() }));
vi.mock('../../../nfl/predictionLedger/capture', () => ({ issueNFLPresentationReceipt: vi.fn() }));

const now = new Date('2026-01-21T18:00:00Z');
const date = '2026-01-21';
const model = projectNBAGame(historicalFixture());
const readiness = { injuriesVerified: true, startingLineupsVerified: true, conflictsResolved: true };

function recommendation(overrides: Partial<GameQuote> = {}, verified = true): GameRecommendation {
  return buildGameRecommendation(model, quote(overrides), binding,
    verified ? readiness : { injuriesVerified: false, startingLineupsVerified: false, conflictsResolved: false }, now);
}

function modeledGame(status: ModeledGameResearch['status'] = 'QUOTE_AVAILABLE'): ModeledGameResearch {
  return { recommendationType: 'GAME', gameId: model.gameId,
    home: { id: model.homeTeamId, name: binding.homeTeam }, away: { id: model.awayTeamId, name: binding.awayTeam },
    projection: withoutScenarios(model), status,
    reason: status === 'MODELED_NOT_BETTABLE' ? 'No timestamped sportsbook quote is available.' : 'Fixture quote available.' };
}

function finderResult(gameCandidates: GameRecommendation[], modeledGames = [modeledGame()]): NBAFinderSummary {
  return { results: [], nbaCandidates: [], gameCandidates, modeledGames,
    gamesAnalyzed: 1, gamesScheduled: 1, propsAnalyzed: 0, booksAnalyzed: gameCandidates.length ? 1 : 0,
    gamesEligible: 1, slateComplete: false, eventsMatched: gameCandidates.length ? 1 : 0, rawPropsTotal: 0,
    analyzedAt: now.toISOString(), slateDate: date, credits: null, blockReason: null, oddsSpend: null,
    fromCache: true, cacheAgeMs: 0, budgetLimited: false,
    playerMatching: { matched: 0, ambiguous: 0, unmatched: 0 },
    marketSupport: { full: 0, partial: 0, unsupported: 0 } };
}

function playerProp(id: 'likely' | 'value'): ResearchCandidateRecord {
  const likely = id === 'likely';
  return { recommendationType: 'PLAYER_PROP', candidateId: id, rank: 0, playerId: likely ? 1 : 2, teamId: 1,
    player: likely ? 'Fixture Guard' : 'Fixture Center', team: 'Home', opponent: 'Away', gameId: model.gameId,
    market: 'Points', marketKey: 'points', line: 20.5, direction: 'over', book: 'Fixture Book', odds: -110,
    availableBooks: 1, projection: 25, projectionUncertainty: 3, edge: 4.5,
    l5Rate: 80, l10Rate: 80, l20Rate: 80, seasonRate: 80, sampleSize: 20,
    researchScore: 90, dataQuality: 95, trueProbability: likely ? 70 : 65, evPercent: likely ? 1 : 10,
    trapRisk: likely ? 10 : 4, priceEdgePercent: 5, priceCurrent: true, priceFreshness: 'FRESH',
    valueQualified: true, isAlternate: false, eliteQualified: false,
    signalAgreement: 4, signalsAvailable: 4, evidenceCoverage: 100, qualification: 'STRONG', rejectionReasons: [],
    grade: 'B', priceGrade: 'B', playerEdgePercent: 5, breakEvenProbability: 52.38,
    projectedRange: null, bestAlternateLine: null, howItLoses: ['Minutes may fall.'], evidenceBoard: [],
    outlierDependencePercent: null, position: 'G', modelProbability: likely ? 70 : 65,
    historicalHitRate: 80, projectionReliability: likely ? 'MEDIUM' : 'HIGH', crossBookThreshold: null,
    marketMovement: null, outlierAnalysis: null, roleContext: { requirement: 'Verified role',
      status: likely ? 'MIXED' : 'STARTER', confidence: 'HIGH', workloadTrend: 'STABLE', reasons: [] },
    opponentContext: null, injuryContext: null, weatherContext: null,
    nbaPrediction: { reliability: likely ? 'MEDIUM' : 'HIGH', contextEvidence: [{ id: 'availability.current',
      kind: 'FACT', state: likely ? 'UNKNOWN' : 'AVAILABLE', metric: 'reportedAvailability',
      value: likely ? 'UNKNOWN' : 'AVAILABLE', units: null, detail: 'Fixture status', direction: 'NEUTRAL',
      directionBasis: null, markets: ['points'], reliability: 'MEDIUM', reliabilityReasons: [], sourceRefs: [],
      sample: null, missingReasons: [], dependencyIds: [], correlationGroup: 'availability' }] } as unknown as ResearchCandidateRecord['nbaPrediction'] };
}

function seedMixed(query: string, game: GameRecommendation): void {
  sessions.set('mixed', { sport: 'nba', date, queryIntent: query, generatedAt: now.toISOString(),
    candidates: [playerProp('value'), playerProp('likely')], gameCandidates: [game], modeledGames: [modeledGame()],
    toolMeta: { gamesFound: 1, gamesScheduled: 1, propsFound: 2, booksFound: 1, candidatesFound: 2,
      eliteFound: 0, cached: true, dataFreshnessSeconds: 0, budgetLimited: false, researchComplete: true } });
}

async function chat(query: string, researchSessionId: string | null = null) {
  const response = await POST(new Request('http://localhost/api/ai/chat', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      messages: [{ role: 'user', content: query }], researchSessionId, context: { sport: 'nba', date },
    }) }));
  expect(response.status).toBe(200);
  const body = await response.json() as AgentTurnResult & { ledgerReceipt: string | null };
  expect(body.meta).toMatchObject({ sport: 'nba', date, modelVersion: 'NBA_GAME_LINES_V1', validationStatus: 'UNVALIDATED' });
  expect(body.ledgerReceipt).toBeNull();
  return body;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessions.clear();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Paid/provider fetch disabled in NBA chat integration tests')));
  vi.mocked(runNBAFinderDeepSearch).mockResolvedValue(finderResult([]));
});

it('reports verified quotes and missing research evidence rather than no sportsbook data', async () => {
  const game = { ...modeledGame(), quotes: [quote()], reason: 'Exact-game official injury evidence is unavailable.' };
  vi.mocked(runNBAFinderDeepSearch).mockResolvedValue({ ...finderResult([], [game]), gamesAnalyzed: 0,
    partialCoverage: true, researchComplete: false, nbaGameCoverage: [{ gameId: game.gameId, eventId: 'odds', state: 'NO_MARKETS' }] });
  const result = await chat('Best NBA picks');
  expect(result.meta).toMatchObject({ gamesFound: 1, candidatesFound: 0, status: 'RESEARCH_INCOMPLETE', researchComplete: false });
  expect(result.results).toEqual([]);
  expect(result.reply).toContain('Verified sportsbook quotes are available');
  expect(result.reply).toContain('official injury evidence is unavailable');
});

afterEach(() => {
  try {
    expect(fetch).not.toHaveBeenCalled();
    expect(issueNFLPresentationReceipt).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});

it('does not route an explicit NFL request into NBA games just because the UI is NBA', async () => {
  const response = await POST(new Request('http://localhost/api/ai/chat', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      messages: [{ role: 'user', content: 'Best NFL spreads' }], context: { sport: 'nba', date },
    }) }));
  expect(response.status).toBe(200);
  expect(vi.mocked(runNBAFinderDeepSearch)).not.toHaveBeenCalled();
  expect((await response.json()).results).toEqual([]);
});

describe('NBA game integration through actual chat POST and real runner/client publication', () => {
  it.each([
    ['moneylines', { market: 'MONEYLINE', selection: 'HOME', team: 'HOME', line: null }],
    ['spreads', { market: 'SPREAD', selection: 'HOME', team: 'HOME', line: -1.5 }],
    ['spreads', { market: 'SPREAD', selection: 'HOME', team: 'HOME', line: 1.5 }],
    ['full-game totals', { market: 'TOTAL', selection: 'OVER', team: null, line: 180.5 }],
    ['team totals', { market: 'TEAM_TOTAL', selection: 'OVER', team: 'HOME', line: 80.5 }],
    ['team totals', { market: 'TEAM_TOTAL', selection: 'OVER', team: 'AWAY', line: 80.5 }],
  ] satisfies Array<[string, Partial<GameQuote>]>)('preserves %s quote identity %j without athlete fields', async (market, overrides) => {
    const record = recommendation(overrides);
    expect(record.pickTier).toBe('EDGE');
    vi.mocked(runNBAFinderDeepSearch).mockResolvedValue(finderResult([record]));
    const result = await chat(`Give me NBA ${market}`);
    expect(runNBAFinderDeepSearch).toHaveBeenCalledExactlyOnceWith(date, { gameLines: true, gameLinesOnly: true });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ recommendationType: 'GAME', candidateId: record.candidateId,
      marketKey: overrides.market, selection: overrides.selection, selectedTeam: overrides.team,
      line: overrides.line, quote: record.quote, pickTier: 'EDGE', rank: 1 });
    expect(result.results[0]).not.toHaveProperty('player');
    expect(result.results[0]).not.toHaveProperty('playerId');
    expect(result.modeledGames).toEqual([modeledGame()]);
    expect(sessions.get(result.researchSessionId!)).toMatchObject({ gameCandidates: [record], candidates: [] });
  });

  it.each([
    ['most likely', ['game', 'likely', 'value']],
    ['best value', ['game', 'value', 'likely']],
    ['best', ['likely', 'value', 'game']],
  ])('ranks mixed player props and games by %s using the real saved candidate ranker', async (ranking, expected) => {
    const query = `Give me ${ranking} NBA player props and moneylines across all markets`;
    const game = recommendation({ market: 'MONEYLINE', selection: 'HOME', team: 'HOME', line: null, americanOdds: 100 });
    expect(game.trueProbability).toBeGreaterThan(70);
    expect(game.evPercent).toBeGreaterThan(10);
    seedMixed(query, game);
    const result = await chat(query, 'mixed');
    expect(result.results.map(row => (row as { candidateId: string }).candidateId))
      .toEqual(expected.map(id => id === 'game' ? game.candidateId : id));
    expect(result.results.map(row => (row as { rank: number }).rank)).toEqual([1, 2, 3]);
    expect(result.results.filter(row => (row as { recommendationType: string }).recommendationType === 'PLAYER_PROP')).toHaveLength(2);
    expect(runNBAFinderDeepSearch).not.toHaveBeenCalled();
  });

  it('keeps missing-quote projections in modeledGames, never in picks or closest misses', async () => {
    const research = modeledGame('MODELED_NOT_BETTABLE');
    vi.mocked(runNBAFinderDeepSearch).mockResolvedValue(finderResult([], [research]));
    const result = await chat('Give me NBA game lines');
    expect(result.results).toEqual([]);
    expect(result.closestMisses).toEqual([]);
    expect(result.modeledGames).toEqual([research]);
    expect(result.reply).toContain('not a betting recommendation');
  });

  it('rechecks saved quotes at publication time and excludes stale formerly qualified picks', async () => {
    const query = 'Give me NBA moneylines';
    const game = recommendation({ market: 'MONEYLINE', selection: 'HOME', team: 'HOME', line: null });
    expect(game.pickTier).toBe('EDGE');
    vi.mocked(runNBAFinderDeepSearch).mockResolvedValue(finderResult([game]));
    const first = await chat(query);
    expect(first.results).toHaveLength(1);
    vi.setSystemTime(new Date('2026-01-21T20:00:00Z'));
    const stale = await chat(query, first.researchSessionId);
    expect(stale.results).toEqual([]);
    expect(stale.closestMisses).toEqual([]);
    expect(stale.modeledGames).toEqual(first.modeledGames);
    expect(runNBAFinderDeepSearch).toHaveBeenCalledTimes(1);
  });

  it('returns no qualifier instead of filling requested slots with failed availability or negative value', async () => {
    const unavailable = recommendation({ market: 'MONEYLINE', selection: 'HOME', team: 'HOME', line: null }, false);
    const negative = recommendation({ market: 'MONEYLINE', selection: 'AWAY', team: 'AWAY', line: null });
    expect([unavailable.pickTier, negative.pickTier]).toEqual(['PASS', 'PASS']);
    vi.mocked(runNBAFinderDeepSearch).mockResolvedValue(finderResult([unavailable, negative]));
    const result = await chat('Give me best 5 NBA moneylines');
    expect(result.results).toEqual([]);
    expect(result.closestMisses).toEqual([]);
    expect(result.reply).toContain('No NBA selections passed');
  });

  it('honors the Elite floor without upgrading unvalidated EDGE game recommendations', async () => {
    const game = recommendation({ market: 'MONEYLINE', selection: 'HOME', team: 'HOME', line: null });
    expect(game.pickTier).toBe('EDGE');
    vi.mocked(runNBAFinderDeepSearch).mockResolvedValue(finderResult([game]));
    const result = await chat('Give me NBA moneylines Elite or better');
    expect(result.results).toEqual([]);
    expect(result.closestMisses).toEqual([]);
    expect(result.modeledGames).toEqual([modeledGame()]);
    expect(result.reply).toContain('No NBA selections passed');
  });
});