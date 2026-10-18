import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runNFLFinderDeepSearch } from '../../finder/nflEngine';
import { getNFLSchedule } from '../../nfl/schedule';
import { NFL_ELITE_MARKETS, type NFLAnalyzableMarketKey } from '../../nfl/oddsTypes';
import { finishNFLSlateLedger, type NFLGameLedger } from '../../nfl/slateLedger';
import type { ResearchCandidateRecord, ResearchSession } from './session';
import { createAgentContext, executeTool, hasNFLRequestedMarketCoverage } from './tools';
import { parseNFLRequestScope } from './nflRequestScope';

vi.mock('../../finder/nflEngine', () => ({ runNFLFinderDeepSearch: vi.fn() }));
vi.mock('../../nfl/schedule', () => ({ getNFLSchedule: vi.fn(), getNFLUpcomingGameDate: vi.fn() }));
vi.mock('./sessionStore', () => ({ saveResearchSession: vi.fn() }));

const fieldGoals = 'player_field_goals';
const kickingPoints = 'player_kicking_points';
const passing = 'player_pass_yds';
const date = '2026-10-18';
const oldMarkets = NFL_ELITE_MARKETS.filter((market) => market !== fieldGoals && market !== kickingPoints);

function game(returnedMarkets: NFLAnalyzableMarketKey[], zeroMarkets: NFLAnalyzableMarketKey[] = []): NFLGameLedger {
  return {
    gameId: 'game-1', matchup: 'Raiders @ Chiefs', kickoff: `${date}T20:00:00Z`, eligibility: 'PREGAME',
    state: 'RESEARCHED', eventId: 'event-1', returnedMarkets, zeroMarkets, failedMarkets: [],
    retrievedAt: new Date().toISOString(), expiresAt: Date.now() + 3600000, failure: null,
    propsEvaluated: 1, fromCache: true,
  };
}

function session(requestedMarkets?: NFLAnalyzableMarketKey[], games?: NFLGameLedger[]): ResearchSession {
  const timestamp = new Date().toISOString();
  return {
    sport: 'nfl', date, queryIntent: 'Best NFL passing props', generatedAt: timestamp,
    candidates: [{
      candidateId: 'passing', marketKey: passing, priceCurrent: true, retrievedAt: timestamp,
      injuryContext: {
        player: { sourceStatus: 'CURRENT', updatedAt: timestamp, availabilityDesignation: 'CONFIRMED_AVAILABLE' },
        sourceStatus: { status: 'CURRENT' }, lastUpdated: timestamp, teammateAbsences: [], opponentAbsences: [],
      },
    } as unknown as ResearchCandidateRecord],
    toolMeta: {
      gamesFound: 1, gamesScheduled: 1, propsFound: 1, booksFound: 1, candidatesFound: 1,
      eliteFound: 0, cached: true, dataFreshnessSeconds: 0, budgetLimited: false, researchComplete: true,
      ...(requestedMarkets ? { nflLedger: finishNFLSlateLedger({ sport: 'nfl', date, requestedMarkets,
        games: games ?? [game(requestedMarkets)] }) } : {}),
    },
  };
}

async function load(saved: ResearchSession, query: string) {
  const context = createAgentContext(saved);
  context.pendingQueryIntent = query;
  context.nflScope = parseNFLRequestScope(query);
  return executeTool('get_sportsbook_candidates', { sport: 'nfl', date }, context);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(runNFLFinderDeepSearch).mockResolvedValue({ gamesScheduled: 0, nflCandidates: [], candidates: [],
    games: [], researchComplete: false } as never);
  vi.mocked(getNFLSchedule).mockResolvedValue([]);
});

describe('NFL requested-market coverage (offline)', () => {
  it('accepts a requested subset without requiring a candidate for verified empty markets', () => {
    const saved = session([passing, fieldGoals, kickingPoints], [game([passing], [fieldGoals, kickingPoints])]);
    expect(hasNFLRequestedMarketCoverage(saved, [fieldGoals, kickingPoints])).toBe(true);
    expect(hasNFLRequestedMarketCoverage(saved, [passing])).toBe(true);
  });

  it('does not mistake zero or returned evidence for a market included in the original request', () => {
    expect(hasNFLRequestedMarketCoverage(session([passing], [game([passing], [fieldGoals])]), [fieldGoals])).toBe(false);
    expect(hasNFLRequestedMarketCoverage(session([passing], [game([passing, fieldGoals])]), [fieldGoals])).toBe(false);
  });

  it('requires coverage in every pregame game', () => {
    const saved = session([fieldGoals, kickingPoints], [game([fieldGoals], [kickingPoints]),
      { ...game([fieldGoals]), gameId: 'game-2' }]);
    expect(hasNFLRequestedMarketCoverage(saved, [fieldGoals, kickingPoints])).toBe(false);
    expect(hasNFLRequestedMarketCoverage(saved, [fieldGoals])).toBe(true);
  });

  it('requires complete ledger research even when all markets were returned', () => {
    const saved = session([fieldGoals]);
    saved.toolMeta.nflLedger!.researchComplete = false;
    expect(hasNFLRequestedMarketCoverage(saved, [fieldGoals])).toBe(false);
  });

  it('rejects failed requested markets even if also marked returned', () => {
    const saved = session([fieldGoals], [{ ...game([fieldGoals]), failedMarkets: [fieldGoals] }]);
    expect(hasNFLRequestedMarketCoverage(saved, [fieldGoals])).toBe(false);
  });

  it('does not require pregame coverage from final or excluded games', () => {
    const saved = session([fieldGoals], [game([fieldGoals]),
      { ...game([]), gameId: 'final', eligibility: 'FINAL' },
      { ...game([]), gameId: 'excluded', eligibility: 'EXCLUDED' }]);
    expect(hasNFLRequestedMarketCoverage(saved, [fieldGoals])).toBe(true);
  });

  it('matches exact market keys, not related or alternate names', () => {
    const saved = session([fieldGoals]);
    for (const market of [kickingPoints, 'player_field_goals_alternate', 'player_field_goal', 'field_goals']) {
      expect(hasNFLRequestedMarketCoverage(saved, [market])).toBe(false);
    }
  });

  it('preserves legacy non-kicking reuse but requires a ledger for either kicking market', () => {
    const saved = session();
    expect(hasNFLRequestedMarketCoverage(saved, [passing])).toBe(true);
    for (const markets of [[fieldGoals], [kickingPoints], [passing, fieldGoals], undefined]) {
      expect(hasNFLRequestedMarketCoverage(saved, markets)).toBe(false);
    }
    saved.candidates[0].marketKey = fieldGoals;
    expect(hasNFLRequestedMarketCoverage(saved, [fieldGoals])).toBe(false);
  });

  it('blocks the old 11-market NFL-wide session and accepts the current default', () => {
    expect(oldMarkets).toHaveLength(11);
    expect(NFL_ELITE_MARKETS).toHaveLength(13);
    expect(hasNFLRequestedMarketCoverage(session(oldMarkets))).toBe(false);
    expect(hasNFLRequestedMarketCoverage(session([...NFL_ELITE_MARKETS]))).toBe(true);
  });
});

describe('NFL tool cache-scope guard (offline)', () => {
  it.each(['Best NFL field goals made props', 'Best NFL kicking points props', 'Best NFL kicker props'])
  ('reuses covered zero-market evidence without provider calls: %s', async (query) => {
    const saved = session([passing, fieldGoals, kickingPoints], [game([passing], [fieldGoals, kickingPoints])]);
    expect(await load(saved, query)).toMatchObject({ data: { reusedExistingSession: true } });
    expect(runNFLFinderDeepSearch).not.toHaveBeenCalled();
    expect(getNFLSchedule).not.toHaveBeenCalled();
  });

  it.each(['Best NFL field goals made props', 'Best NFL kicking points props'])
  ('rejects a fresh available passing-only session for %s', async (query) => {
    const saved = session(oldMarkets);
    expect(await load(saved, 'Best NFL passing yards props')).toMatchObject({ data: { reusedExistingSession: true } });
    expect(runNFLFinderDeepSearch).not.toHaveBeenCalled();
    const result = await load(saved, query);
    expect(result.data).not.toMatchObject({ reusedExistingSession: true });
    expect(runNFLFinderDeepSearch).toHaveBeenCalled();
  });

  it.each([session(oldMarkets), session()])('blocks unsafe NFL-wide reuse', async (saved) => {
    const result = await load(saved, 'Best NFL props');
    expect(result.data).not.toMatchObject({ reusedExistingSession: true });
    expect(runNFLFinderDeepSearch).toHaveBeenCalled();
  });

  it('reuses the fully covered NFL-wide default without provider calls', async () => {
    expect(await load(session([...NFL_ELITE_MARKETS]), 'Best NFL props')).toMatchObject({ data: { reusedExistingSession: true } });
    expect(runNFLFinderDeepSearch).not.toHaveBeenCalled();
    expect(getNFLSchedule).not.toHaveBeenCalled();
  });
});