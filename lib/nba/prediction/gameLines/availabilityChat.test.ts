import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../../../app/api/ai/chat/route';
import type { toClientResult } from '../../../ai/agent/runner';
import type { ResearchSession } from '../../../ai/agent/session';
import { runNBAFinderDeepSearch, type NBAFinderSummary } from '../../../finder/nbaEngine';
import { issueNFLPresentationReceipt } from '../../../nfl/predictionLedger/capture';
import { availabilityDependencies, availabilityEvent, availabilityFixture, availabilityGame, availabilityTime,
  type AvailabilityScenario } from './availability.fixtures';
import { binding, historicalFixture, quote } from './fixtures';
import { assessGameMarket } from './markets';
import { projectNBAGame } from './model';
import { researchNBAGameLines } from './pipeline';
import { classifyGameRecommendation } from './recommendations';
import type { GameQuote } from './types';

const sessions = vi.hoisted(() => new Map<string, ResearchSession>());
vi.mock('../../../ai/agent/sessionStore', () => ({
  getResearchSession: vi.fn(async (id: string | null) => id ? structuredClone(sessions.get(id) ?? null) : null),
  saveResearchSession: vi.fn(async (session: ResearchSession) => {
    const id = `availability-session-${sessions.size}`;
    sessions.set(id, structuredClone(session));
    return id;
  }),
  deleteResearchSession: vi.fn(async (id: string) => { sessions.delete(id); }),
}));
vi.mock('../../../finder/nbaEngine', () => ({ runNBAFinderDeepSearch: vi.fn() }));
vi.mock('../../../nfl/predictionLedger/capture', () => ({ issueNFLPresentationReceipt: vi.fn() }));

const date = '2026-01-21';
let scenario: AvailabilityScenario;
let actualQuote: GameQuote;
let research: Awaited<ReturnType<typeof researchNBAGameLines>>;

async function finderWrapper(): Promise<NBAFinderSummary> {
  const fixture = availabilityFixture(scenario);
  research = await researchNBAGameLines([availabilityGame()], [availabilityEvent()], availabilityDependencies(fixture, actualQuote));
  return { results: [], nbaCandidates: [], gameCandidates: research.recommendations, modeledGames: research.modeledGames,
    gamesAnalyzed: 1, gamesScheduled: 1, propsAnalyzed: 0, booksAnalyzed: 1, gamesEligible: 1,
    slateComplete: false, eventsMatched: 1, rawPropsTotal: 0, analyzedAt: availabilityTime, slateDate: date,
    credits: null, blockReason: null, oddsSpend: null, fromCache: true, cacheAgeMs: 0, budgetLimited: false,
    playerMatching: { matched: 0, ambiguous: 0, unmatched: 0 },
    marketSupport: { full: 0, partial: 0, unsupported: 0 } };
}

async function chat(query = 'Give me NBA moneylines', researchSessionId: string | null = null) {
  const response = await POST(new Request('http://localhost/api/ai/chat', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      messages: [{ role: 'user', content: query }], researchSessionId, context: { sport: 'nba', date },
    }) }));
  expect(response.status).toBe(200);
  const body = await response.json() as ReturnType<typeof toClientResult> & { ledgerReceipt: string | null };
  expect(body.meta).toMatchObject({ sport: 'nba', date, modelVersion: 'NBA_GAME_LINES_V1', validationStatus: 'UNVALIDATED' });
  expect(body.ledgerReceipt).toBeNull();
  return body;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessions.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(availabilityTime));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('All network/provider fetches forbidden in availability chat tests'); }));
  scenario = 'healthy';
  actualQuote = quote({ market: 'MONEYLINE', selection: 'HOME', team: 'HOME', line: null });
  vi.mocked(runNBAFinderDeepSearch).mockImplementation(finderWrapper);
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

describe('availability through actual chat POST, real runner and real NBA game-line pipeline', () => {
  it.each([
    ['moneylines', { market: 'MONEYLINE', selection: 'HOME', team: 'HOME', line: null }],
    ['spreads', { market: 'SPREAD', selection: 'HOME', team: 'HOME', line: -1.5 }],
    ['full-game totals', { market: 'TOTAL', selection: 'OVER', team: null, line: 180.5 }],
    ['team totals', { market: 'TEAM_TOTAL', selection: 'OVER', team: 'HOME', line: 80.5 }],
    ['team totals', { market: 'TEAM_TOTAL', selection: 'OVER', team: 'AWAY', line: 80.5 }],
  ] satisfies Array<[string, Partial<GameQuote>]>)('publishes healthy verified %s as EDGE with unchanged quote and EV', async (market, overrides) => {
    actualQuote = quote(overrides);
    const baseline = assessGameMarket(projectNBAGame(historicalFixture()), actualQuote, binding);
    const result = await chat(`Give me NBA ${market}`);
    expect(runNBAFinderDeepSearch).toHaveBeenCalledExactlyOnceWith(date, { gameLines: true, gameLinesOnly: true });
    expect(research.recommendations).toHaveLength(1);
    const record = research.recommendations[0];
    expect(record).toMatchObject({ pickTier: 'EDGE', availabilityVerified: true,
      availability: { impactReviewResolved: true, injuriesVerified: true, startingLineupsVerified: true, blockers: [] } });
    expect(record.assessment).toEqual(baseline);
    expect(record.quote).toEqual(actualQuote);
    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({ recommendationType: 'GAME', candidateId: record.candidateId,
      marketKey: actualQuote.market, selection: actualQuote.selection, selectedTeam: actualQuote.team,
      line: actualQuote.line, quote: actualQuote, evPercent: baseline.evPercent,
      trueProbability: baseline.conditionalWinProbability! * 100, pickTier: 'EDGE', rank: 1 });
    expect(result.results[0]).not.toHaveProperty('playerId');
    expect(result.results[0]).not.toHaveProperty('player');
    expect(result.modeledGames).toEqual(research.modeledGames);
    expect(sessions.get(result.researchSessionId!)).toMatchObject({ candidates: [], gameCandidates: [record], modeledGames: research.modeledGames });
  });

  it.each([
    ['projected', /no fresh officially confirmed starting five/],
    ['questionable', /player 101: QUESTIONABLE/],
    ['stale', /official target-game injury report stale/],
    ['missing', /Team 2: official target-game injury report missing/],
    ['restriction', /restriction\/rotation change 20_MINUTES/],
    ['meaningfulOUT', /meaningful\/unknown-impact absence/],
  ] as const)('returns no picks for %s and retains actual availability blockers in modeledGames', async (variant, blocker) => {
    scenario = variant;
    const result = await chat('Give me best 5 NBA moneylines');
    expect(research.recommendations).toHaveLength(1);
    expect(research.recommendations[0]).toMatchObject({ pickTier: 'PASS', availabilityVerified: false });
    expect(research.recommendations[0].quote).toEqual(actualQuote);
    expect(research.recommendations[0].assessment).toEqual(assessGameMarket(projectNBAGame(historicalFixture()), actualQuote, binding));
    expect(result.results).toEqual([]);
    expect(result.closestMisses).toEqual([]);
    expect(result.modeledGames).toEqual(research.modeledGames);
    expect(result.modeledGames).toHaveLength(1);
    expect(result.modeledGames![0].availability?.impactReviewResolved).toBe(false);
    expect(result.modeledGames![0].availability?.blockers.join(' ')).toMatch(blocker);
    expect(result.modeledGames![0].reason).toMatch(blocker);
  });

  it('rejects stale cached followup at use time without rerunning Finder or altering quote/EV', async () => {
    const first = await chat();
    expect(first.results).toHaveLength(1);
    const saved = structuredClone(sessions.get(first.researchSessionId!)!);
    vi.setSystemTime(new Date('2026-01-21T20:40:00Z'));
    const second = await chat('Give me NBA moneylines', first.researchSessionId);
    expect(second.results).toEqual([]);
    expect(second.closestMisses).toEqual([]);
    expect(second.modeledGames).toEqual(first.modeledGames);
    expect(runNBAFinderDeepSearch).toHaveBeenCalledTimes(1);
    expect(sessions.get(first.researchSessionId!)).toEqual(saved);
    const expired = classifyGameRecommendation(saved.gameCandidates![0], new Date());
    expect(expired.pickTier).toBe('PASS');
    expect(expired.tierRequirementsFailed).toContain('Availability evidence expired at use time.');
  });

  it('rejects expired saved availability even when the same game price was just reobserved', async () => {
    const first = await chat();
    expect(first.results).toHaveLength(1);
    const saved = sessions.get(first.researchSessionId!)!;
    const original = structuredClone(saved.gameCandidates![0]);
    const record = saved.gameCandidates![0];
    record.quote = { ...record.quote, updatedAt: '2026-01-21T20:30:00Z', observedAt: '2026-01-21T20:31:00Z' };
    vi.setSystemTime(new Date('2026-01-21T20:40:00Z'));
    expect(record.quote.americanOdds).toBe(original.quote.americanOdds);
    expect(record.quote.line).toBe(original.quote.line);
    expect(record.assessment).toEqual(original.assessment);
    expect(record.availability).toEqual(original.availability);
    const expired = classifyGameRecommendation(record, new Date());
    expect(expired.pickTier).toBe('PASS');
    expect(expired.tierRequirementsFailed).toContain('Availability evidence expired at use time.');
    const result = await chat('Give me NBA moneylines', first.researchSessionId);
    expect(result.results).toEqual([]);
    expect(result.closestMisses).toEqual([]);
    expect(runNBAFinderDeepSearch).toHaveBeenCalledTimes(1);
  });

  it.each(['Elite or better', 'Nukes only', 'NUKE'])('never upgrades verified but unvalidated EDGE games for a %s request', async floor => {
    const result = await chat(`Give me NBA moneylines ${floor}`);
    expect(research.recommendations[0].pickTier).toBe('EDGE');
    expect(research.recommendations[0].availabilityVerified).toBe(true);
    expect(result.results.map(row => (row as { pickTier: string }).pickTier), `Requested ${floor}; expected no lower-tier fallback`).toEqual([]);
    expect(result.results).toEqual([]);
    expect(result.closestMisses).toEqual([]);
    expect(result.modeledGames).toEqual(research.modeledGames);
    expect(result.reply).toContain('No NBA selections passed');
  });
});