import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../../../app/api/ai/chat/route';
import type { toClientResult } from '../../../ai/agent/runner';
import type { ResearchSession } from '../../../ai/agent/session';
import { runNBAFinderDeepSearch, type NBACandidate, type NBAFinderSummary } from '../../../finder/nbaEngine';
import { getNBASchedule } from '../../schedule';
import type { NBAGame } from '../../types';
import type { PickPresentationInput } from '../../presentation';
import { loadCachedNBAEventResearch } from './cachedEventResearch';
import { binding, historicalFixture, quote } from './fixtures';
import { projectNBAGame } from './model';
import { buildGameRecommendation, type GameRecommendation, type ModeledGameResearch, type NBARecommendation } from './recommendations';
import { normalizeNBAResearchFilter, type NBAResearchFilter } from '../../researchMarkets';
import { NBA_VERIFIED_RESEARCH_MARKETS } from '../researchReceipt';

const sessions = vi.hoisted(() => new Map<string, ResearchSession>());
vi.mock('../../../ai/agent/sessionStore', () => ({
  getResearchSession: vi.fn(async (id: string | null) => id ? structuredClone(sessions.get(id) ?? null) : null),
  saveResearchSession: vi.fn(async (session: ResearchSession) => {
    const id = `scope-session-${sessions.size}`;
    sessions.set(id, structuredClone(session));
    return id;
  }),
  deleteResearchSession: vi.fn(async (id: string) => { sessions.delete(id); }),
}));
vi.mock('../../../finder/nbaEngine', () => ({ runNBAFinderDeepSearch: vi.fn() }));
vi.mock('../../schedule', () => ({ getNBASchedule: vi.fn() }));
vi.mock('./cachedEventResearch', () => ({ loadCachedNBAEventResearch: vi.fn() }));

const now = new Date('2026-01-21T18:00:00Z');
const date = '2026-01-21';
const targetQuery = 'Best NBA Celtics vs Pistons moneylines today';
const otherQuery = 'Best NBA Lakers vs Warriors moneylines today';
const absentQuery = 'Best NBA Lakers vs Celtics moneylines today';
const model = projectNBAGame(historicalFixture());
const team = (id: number, displayName: string) => ({ id, displayName, name: displayName, abbreviation: 'FIX', logoUrl: null });
const schedule: NBAGame[] = [
  { id: 'target', gameTime: model.startsAt, completed: false, homeScore: null, awayScore: null,
    homeTeam: team(model.homeTeamId, 'Boston Celtics'), awayTeam: team(model.awayTeamId, 'Detroit Pistons') },
  { id: 'other', gameTime: model.startsAt, completed: false, homeScore: null, awayScore: null,
    homeTeam: team(3, 'Los Angeles Lakers'), awayTeam: team(4, 'Golden State Warriors') },
];

function recommendation(game: NBAGame): GameRecommendation {
  const eventId = `odds-${game.id}`;
  return buildGameRecommendation({ ...model, gameId: game.id, homeTeamId: game.homeTeam.id, awayTeamId: game.awayTeam.id },
    quote({ eventId, homeTeam: game.homeTeam.displayName, awayTeam: game.awayTeam.displayName,
      market: 'MONEYLINE', selection: 'HOME', team: 'HOME', line: null }),
    { ...binding, sourceGameId: game.id, eventId, homeTeam: game.homeTeam.displayName, awayTeam: game.awayTeam.displayName },
    { injuriesVerified: true, startingLineupsVerified: true, conflictsResolved: true }, now);
}

const games = schedule.map(recommendation);
const modeledGames: ModeledGameResearch[] = games.map(game => ({ recommendationType: 'GAME', gameId: game.gameId,
  home: game.home, away: game.away, projection: game.projection, status: 'QUOTE_AVAILABLE', reason: 'Offline bound quote available.' }));

function rawProp(game: NBAGame): NBACandidate {
  return { sport: 'nba', id: `raw-prop-${game.id}`, eventId: `odds-${game.id}`, gameId: game.id,
    playerId: null, playerName: `Unmatched Player ${game.id}`, playerMatch: 'UNMATCHED',
    team: game.homeTeam.displayName, opponent: game.awayTeam.displayName, market: 'points', marketLabel: 'Points',
    historicalSupport: 'unsupported', line: 20.5, side: 'over', book: 'Fixture Book', oddsAmerican: -110, isAlternate: false,
    priceTimestamp: now.toISOString(), priceFreshness: 'FRESH', history: null, projection: null, injuryTier: null,
    injuryEvidence: 'FEED_UNAVAILABLE', nbaPrediction: null, researchContext: null, intelligenceSnapshot: null,
    outlierDependency: null, alternateLines: null, crossBookThreshold: null,
    marketMovement: { available: false, direction: 'unavailable', openingOdds: null, currentOdds: null,
      observedOverMinutes: null, pointCount: 0, label: null },
    howItLoses: [], position: null, opponentContext: null, eliteAnalysis: null };
}

function providerCard(game: NBAGame, kind: 'GAME_LINE' | 'PLAYER_PROP'): PickPresentationInput {
  return { candidateId: `provider-${kind}-${game.id}`,
    subject: kind === 'GAME_LINE'
      ? { kind, gameId: `provider-event-${game.id}`, home: { id: null, name: game.homeTeam.displayName },
        away: { id: null, name: game.awayTeam.displayName },
        market: { key: 'MONEYLINE', label: 'Moneyline', type: 'MONEYLINE', line: null, selection: 'HOME', team: 'HOME' } }
      : { kind, gameId: game.id, player: { id: null, name: `Cached Player ${game.id}`, team: null },
        market: { key: 'player_points', label: 'Points', line: 20.5, side: 'over' } },
    tierDecision: null, trueProbability: null, modelProbability: null, evPercent: null, researchScore: null,
    seasonPhase: null, seasonPhaseCertainty: 'MISSING', sportsbook: 'Fixture Book', americanOdds: -110,
    quoteStatus: 'CURRENT', missing: ['No verified model binding.'], researchEvidence: [] };
}

const providerCards = schedule.flatMap(game => [providerCard(game, 'GAME_LINE'), providerCard(game, 'PLAYER_PROP')]);

function summary(includeGames = true): NBAFinderSummary {
  return { results: [], nbaCandidates: includeGames ? schedule.map(rawProp) : [],
    gameCandidates: includeGames ? games : [], modeledGames: includeGames ? modeledGames : [],
    gamesAnalyzed: includeGames ? 2 : 0, gamesScheduled: 2, propsAnalyzed: includeGames ? 2 : 0,
    booksAnalyzed: includeGames ? 1 : 0, gamesEligible: includeGames ? 2 : 0, slateComplete: false,
    eventsMatched: includeGames ? 2 : 0, rawPropsTotal: includeGames ? 2 : 0,
    analyzedAt: now.toISOString(), slateDate: date, credits: null, blockReason: null, oddsSpend: null,
    fromCache: true, cacheAgeMs: 0, budgetLimited: false,
    playerMatching: { matched: 0, ambiguous: 0, unmatched: includeGames ? 2 : 0 },
    marketSupport: { full: 0, partial: 0, unsupported: includeGames ? 2 : 0 } };
}

async function chat(query: string, researchSessionId: string | null = null, nbaResearchFilter?: NBAResearchFilter) {
  const response = await POST(new Request('http://localhost/api/ai/chat', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      messages: [{ role: 'user', content: query }], researchSessionId, context: { sport: 'nba', date, nbaResearchFilter },
    }) }));
  expect(response.status).toBe(200);
  const result = await response.json() as Omit<ReturnType<typeof toClientResult>, 'results'>
    & { results: NBARecommendation[]; ledgerReceipt: string | null };
  expect(result.meta).toMatchObject({ sport: 'nba', date, modelVersion: 'NBA_GAME_LINES_V1', validationStatus: 'UNVALIDATED' });
  expect(result.nbaPresentation).toBeDefined();
  expect(result.ledgerReceipt).toBeNull();
  return result;
}

function expectScoped(result: Awaited<ReturnType<typeof chat>>, gameIndex: number, includeRawProp = true) {
  const game = games[gameIndex];
  const excluded = schedule[1 - gameIndex];
  expect(result.results.map(record => record.candidateId)).toEqual([game.candidateId]);
  expect(result.modeledGames).toEqual([modeledGames[gameIndex]]);
  expect(result.nbaPresentation!.recommendedCandidateIds).toEqual([game.candidateId]);
  expect(result.nbaPresentation!.recommendations.map(pick => pick.candidateId)).toEqual([game.candidateId]);
  expect(result.nbaPresentation!.picks.map(pick => pick.candidateId).sort()).toEqual([
    game.candidateId, ...(includeRawProp ? [`raw-prop-${game.gameId}`] : []),
    `provider-GAME_LINE-${game.gameId}`, `provider-PLAYER_PROP-${game.gameId}`,
  ].sort());
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain(excluded.homeTeam.displayName);
  expect(serialized).not.toContain(excluded.awayTeam.displayName);
  expect(serialized).not.toContain(`raw-prop-${excluded.id}`);
  expect(serialized).not.toContain(`provider-GAME_LINE-${excluded.id}`);
  expect(serialized).not.toContain(`provider-PLAYER_PROP-${excluded.id}`);
}

function expectAbsent(result: Awaited<ReturnType<typeof chat>>) {
  expect(result.results).toEqual([]);
  expect(result.closestMisses).toEqual([]);
  expect(result.modeledGames).toEqual([]);
  expect(result.nbaPresentation).toMatchObject({ picks: [], recommendations: [], researchedCandidates: [], recommendedCandidateIds: [] });
  const serialized = JSON.stringify(result);
  for (const game of games) expect(serialized).not.toContain(game.candidateId);
  for (const card of providerCards) expect(serialized).not.toContain(card.candidateId);
  expect(serialized).not.toContain('Golden State Warriors');
  expect(serialized).not.toContain('Detroit Pistons');
  expect(serialized).not.toContain('raw-prop-');
}

beforeEach(() => {
  vi.clearAllMocks();
  sessions.clear();
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('All network and paid fetch forbidden in NBA scope POST tests'); }));
  vi.mocked(getNBASchedule).mockResolvedValue(schedule);
  vi.mocked(runNBAFinderDeepSearch).mockResolvedValue(summary());
  vi.mocked(loadCachedNBAEventResearch).mockResolvedValue(providerCards);
  for (const game of games) {
    expect(game.assessment.status).toBe('PRICED');
    expect(game.pickTier).toBe('EDGE');
  }
});

afterEach(() => {
  try { expect(fetch).not.toHaveBeenCalled(); }
  finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
});

describe('NBA matchup scope through real POST and runner', () => {
  it('explains budget-blocked selected markets for another game without claiming complete research', async () => {
    vi.mocked(runNBAFinderDeepSearch).mockResolvedValue({ ...summary(), budgetLimited: true, researchComplete: false, partialCoverage: true,
      nbaResearchPreflight: { availableCredits: 70, expectedCredits: 104, reservedPlanCredits: 52, completeWithinBudget: false, games: [{
        eventId: 'blocked', homeTeam: 'Boston Celtics', awayTeam: 'Detroit Pistons', refreshMarkets: ['player_points'],
        expectedCredits: 52, allowed: false, status: 'BUDGET_BLOCKED', markets: [{ id: 'player_points', state: 'MISSING', needsRefresh: true }],
      }] } });
    const result = await chat('Best NBA picks today', null, normalizeNBAResearchFilter({ marketIds: ['player_points'] }));
    expect(result.meta?.researchComplete).toBe(false);
    expect(result.meta?.partialCoverage).toBe(true);
    expect(result.meta?.unsupportedMarketNotice).toContain('search budget prevented acquisition');
    expect(result.meta?.unsupportedMarketNotice).toContain('player_points: missing');
    expect(result.meta?.nbaResearchPreflight).toMatchObject({ expectedCredits: 104, completeWithinBudget: false });
  });
  it('passes the entire 26-market Research Filter through the real handler without silently truncating scope', async () => {
    const result = await chat('Best NBA picks today', null, normalizeNBAResearchFilter({
      marketIds: NBA_VERIFIED_RESEARCH_MARKETS, sides: ['over', 'under'], ranking: 'BEST',
    }));
    expect(runNBAFinderDeepSearch).toHaveBeenCalledWith(date, expect.objectContaining({
      researchMarkets: NBA_VERIFIED_RESEARCH_MARKETS, gameLines: true, gameLinesOnly: false,
    }));
    const selection = result.meta?.marketSelection as Array<{ id: string }>;
    expect(selection).toHaveLength(26);
    expect(new Set(selection.map(entry => entry.id))).toEqual(new Set(NBA_VERIFIED_RESEARCH_MARKETS));
    expect(result.nbaPresentation!.picks.length).toBeGreaterThan(0);
    expect(result.meta?.partialCoverage).toBe(true);
    expect(result.meta?.researchComplete).toBe(false);
    expect(result.meta?.unsupportedMarketNotice).toContain('1Q Assists');
  });
  it('returns exact Q1 and alternate source identities as research-only without standard recommendations', async () => {
    const q1 = providerCard(schedule[0], 'PLAYER_PROP');
    q1.subject.market = { ...q1.subject.market, key: 'player_assists_q1', label: '1Q Assists', line: 1.5 };
    const alternate = providerCard(schedule[0], 'GAME_LINE');
    alternate.candidateId = 'verified-alternate';
    if (alternate.subject.kind === 'GAME_LINE') alternate.subject.market = { ...alternate.subject.market,
      key: 'alternate_totals', type: 'TOTAL', label: 'Alternate Total', line: 240.5, selection: 'UNDER' };
    vi.mocked(loadCachedNBAEventResearch).mockResolvedValue([q1, alternate, ...providerCards]);
    const result = await chat('Best NBA picks today', null, normalizeNBAResearchFilter({ marketIds: ['player_assists_q1', 'alternate_totals'] }));
    expect(result.results).toEqual([]);
    expect(result.nbaPresentation!.picks).toHaveLength(2);
    expect(new Set(result.nbaPresentation!.picks.map(pick => pick.subject.market.key))).toEqual(new Set(['player_assists_q1', 'alternate_totals']));
    expect(result.nbaPresentation!.recommendedCandidateIds).toEqual([]);
    expect(result.nbaPresentation!.picks.every(pick => pick.tierDecision == null)).toBe(true);
  });
  it('applies structured mixed selections to recommendations and every research card without changing stored research', async () => {
    const result = await chat('Best NBA picks today', null, normalizeNBAResearchFilter({
      marketIds: ['h2h', 'player_points', 'player_assists', 'player_points_q1'], sides: ['over', 'under'], ranking: 'BEST_VALUE',
    }));
    expect(runNBAFinderDeepSearch).toHaveBeenCalledWith(date, { gameLines: true, gameLinesOnly: false,
      researchMarkets: ['h2h', 'player_points', 'player_assists', 'player_points_q1'] });
    expect(result.results).toHaveLength(2);
    expect(result.nbaPresentation!.picks.some(pick => pick.subject.market.key === 'player_points')).toBe(true);
    expect(result.nbaPresentation!.picks.every(pick => ['MONEYLINE', 'points', 'player_points'].includes(pick.subject.market.key))).toBe(true);
    expect(result.meta).toMatchObject({ partialCoverage: true, researchComplete: false });
    expect(result.meta?.unsupportedMarketNotice).toContain('1Q Points');
    expect([...sessions.values()][0].nbaPresentationResearch).toEqual(expect.arrayContaining(providerCards));
    expect([...sessions.values()][0].nbaPresentationResearch).toHaveLength(providerCards.length + schedule.length);
  });

  it('keeps explicit prop-only requests separate from team recommendations', async () => {
    const result = await chat('Best NBA picks today', null, normalizeNBAResearchFilter({ marketIds: ['player_assists'], sides: ['under'] }));
    expect(result.results).toEqual([]);
    expect(result.nbaPresentation!.picks).toEqual([]);
    expect(result.meta?.unsupportedMarketNotice).toContain('Assists');
  });

  it.each([{ marketIds: [] }, { marketIds: ['points_q2'] }, { marketIds: ['dunks'] }])('does no Finder or provider work for disconnected/empty selections $marketIds', async ({ marketIds }) => {
    const response = await POST(new Request('http://localhost/api/ai/chat', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        messages: [{ role: 'user', content: 'Best NBA picks today' }],
        context: { sport: 'nba', date, nbaResearchFilter: normalizeNBAResearchFilter({ marketIds }) },
      }) }));
    const result = await response.json();
    expect(result.results).toEqual([]);
    expect(result.meta.researchComplete).toBe(false);
    expect(result.reply).toContain('No research was performed');
    expect(runNBAFinderDeepSearch).not.toHaveBeenCalled();
    expect(loadCachedNBAEventResearch).not.toHaveBeenCalled();
  });

  it('selects target schedule IDs and postfilters unrelated Finder and cached/provider cards', async () => {
    expect(schedule).toHaveLength(2);
    const result = await chat(targetQuery);
    expect(getNBASchedule).toHaveBeenCalledExactlyOnceWith(date);
    expect(runNBAFinderDeepSearch).toHaveBeenCalledExactlyOnceWith(date, {
      gameLines: true, gameLinesOnly: true, validationGameIds: ['target'],
    });
    expect(loadCachedNBAEventResearch).toHaveBeenCalledExactlyOnceWith(date);
    expectScoped(result, 0);
  });

  it('reuses the mixed cached pool across changed scopes and reclassifies stale quotes without Finder', async () => {
    const query = 'Best NBA moneylines today';
    sessions.set('seeded', { sport: 'nba', date, queryIntent: query, generatedAt: now.toISOString(),
      candidates: [], gameCandidates: games.map(game => ({ ...game, pickTier: 'NUKE', tierScore: 100 })),
      modeledGames, nbaPresentationResearch: providerCards,
      toolMeta: { gamesFound: 2, gamesScheduled: 2, propsFound: 0, booksFound: 1, candidatesFound: 0,
        eliteFound: 0, cached: true, dataFreshnessSeconds: 0, budgetLimited: false, researchComplete: true } });
    const snapshot = structuredClone(sessions.get('seeded')!);
    const target = await chat(targetQuery, 'seeded');
    expectScoped(target, 0, false);
    expect(target.results[0]).toMatchObject({ gameId: 'target', pickTier: 'EDGE' });
    const other = await chat(otherQuery, 'seeded');
    expectScoped(other, 1, false);
    expect(other.results[0]).toMatchObject({ gameId: 'other', pickTier: 'EDGE' });
    expectAbsent(await chat(absentQuery, 'seeded'));
    const unrestricted = await chat(query, 'seeded');
    expect(new Set(unrestricted.results.map(record => record.gameId))).toEqual(new Set(['target', 'other']));
    vi.setSystemTime(new Date('2026-01-21T20:00:00Z'));
    const stale = await chat(targetQuery, 'seeded');
    expect(stale.results).toEqual([]);
    expect(stale.modeledGames).toEqual([modeledGames[0]]);
    expect(stale.nbaPresentation!.picks.find(pick => pick.candidateId === games[0].candidateId)).toMatchObject({
      tierDecision: { pickTier: 'PASS' }, pricing: { state: 'UNPRICED', americanOdds: null, quoteStatus: 'STALE' },
    });
    expect(JSON.stringify(stale)).not.toContain('Los Angeles Lakers');
    expect(runNBAFinderDeepSearch).not.toHaveBeenCalled();
    expect(getNBASchedule).not.toHaveBeenCalled();
    expect(loadCachedNBAEventResearch).not.toHaveBeenCalled();
    expect(sessions.get('seeded')).toEqual(snapshot);
  });

  it.each([false, true])('passes [] for an absent matchup and never falls back to unrelated research (Finder has games: %s)', async includeGames => {
    vi.mocked(runNBAFinderDeepSearch).mockResolvedValue(summary(includeGames));
    const result = await chat(absentQuery);
    expect(getNBASchedule).toHaveBeenCalledExactlyOnceWith(date);
    expect(runNBAFinderDeepSearch).toHaveBeenCalledExactlyOnceWith(date, {
      gameLines: true, gameLinesOnly: true, validationGameIds: [],
    });
    expectAbsent(result);
  });

  it('changes scope on the session saved by a fresh scoped search without reusing the old matchup', async () => {
    const first = await chat(targetQuery);
    expectScoped(first, 0);
    expect(first.researchSessionId).toBeTruthy();
    vi.mocked(runNBAFinderDeepSearch).mockClear();
    vi.mocked(getNBASchedule).mockClear();
    expectScoped(await chat(otherQuery, first.researchSessionId), 1);
    expectAbsent(await chat(absentQuery, first.researchSessionId));
    expectScoped(await chat(targetQuery, first.researchSessionId), 0);
    expect(runNBAFinderDeepSearch).not.toHaveBeenCalled();
    expect(getNBASchedule).not.toHaveBeenCalled();
  });
});