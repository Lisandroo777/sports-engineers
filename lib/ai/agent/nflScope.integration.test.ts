import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyRequestScope, createAgentContext, executeTool, prepareNFLRequestScope } from './tools';
import { runAgentTurn, toClientResult } from './runner';
import { runNFLFinderDeepSearch } from '../../finder/nflEngine';
import { searchNFLPlayers } from '../../nfl/players';
import type { NFLPlayer } from '../../nfl/types';
import { getNFLUpcomingGameDate } from '../../nfl/schedule';
import { getResearchSession } from './sessionStore';

vi.mock('../../finder/nflEngine', () => ({ runNFLFinderDeepSearch: vi.fn() }));
vi.mock('../../nfl/players', () => ({ searchNFLPlayers: vi.fn() }));
vi.mock('../../nfl/schedule', () => ({ getNFLUpcomingGameDate: vi.fn(), getNFLSchedule: vi.fn() }));
vi.mock('../../nfl/teams', () => ({ getNFLTeams: vi.fn().mockResolvedValue([
  { id: 12, displayName: 'Kansas City Chiefs' }, { id: 13, displayName: 'Las Vegas Raiders' },
  { id: 15, displayName: 'Miami Dolphins' },
]) }));
vi.mock('./sessionStore', () => ({ getResearchSession: vi.fn().mockResolvedValue(null), saveResearchSession: vi.fn().mockResolvedValue('saved') }));

const player = {
  id: 3139477, name: 'Patrick Mahomes', position: 'QB', team: { id: 12, displayName: 'Kansas City Chiefs' },
} as NFLPlayer;

function preflight(unmatched = false) {
  return {
    gamesScheduled: 2, gamesEligible: 2, gamesAnalyzed: 0, propsAnalyzed: 0, nflCandidates: [],
    validationPreflight: {
      cacheMisses: 0, preflightState: 'READY',
      games: [
        { gameId: 'chiefs', matchup: 'Kansas City Chiefs @ Las Vegas Raiders', eventId: unmatched ? null : 'chiefs-event', marketsCacheState: unmatched ? 'EVENT_UNAVAILABLE' : 'CACHE_FRESH' },
        { gameId: 'vikings', matchup: 'Miami Dolphins @ Minnesota Vikings', eventId: 'vikings-event', marketsCacheState: 'CACHE_FRESH' },
      ],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('ODDS_ALLOW_PAID_REFRESH', 'false');
  vi.stubEnv('OPENAI_API_KEY', 'test-only');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network is disabled in Stage 1 integration tests')));
  vi.mocked(searchNFLPlayers).mockResolvedValue([player]);
  vi.mocked(getNFLUpcomingGameDate).mockResolvedValue('2026-10-04');
  vi.mocked(runNFLFinderDeepSearch).mockResolvedValue(preflight() as never);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('NFL player scope before sportsbook loading', () => {
  it.each(['Best Mahomes props', 'Best Patrick Mahomes props'])('resolves %s to one player and game', async (query) => {
    const context = createAgentContext();
    applyRequestScope(context, query, '2026-10-04');
    vi.mocked(runNFLFinderDeepSearch).mockResolvedValueOnce(preflight() as never).mockResolvedValueOnce({
      gamesAnalyzed: 1, gamesEligible: 2, gamesScheduled: 2, propsAnalyzed: 0, nflCandidates: [],
    } as never);
    await executeTool('get_sportsbook_candidates', { sport: 'mlb', date: '2026-10-04' }, context);
    expect(context.canonicalSport).toBe('nfl');
    expect(context.nflScope?.playerId).toBe(player.id);
    expect(context.nflScope?.playerName).toBe(player.name);
    expect(runNFLFinderDeepSearch).toHaveBeenNthCalledWith(2, '2026-10-04', { validationGameIds: ['chiefs'], playerId: player.id });
    expect(searchNFLPlayers).toHaveBeenCalledBefore(vi.mocked(runNFLFinderDeepSearch));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('clarifies an unknown player before any sportsbook preflight', async () => {
    vi.mocked(searchNFLPlayers).mockResolvedValue([]);
    const context = createAgentContext();
    applyRequestScope(context, 'Best Unknown Player NFL props', '2026-10-04');
    const result = await executeTool('get_sportsbook_candidates', { sport: 'nfl' }, context);
    expect(result.status).toBe('NOT_FOUND');
    expect(result.error).toContain('Which NFL player');
    expect(runNFLFinderDeepSearch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns a clean clarification without a model request', async () => {
    vi.mocked(searchNFLPlayers).mockResolvedValue([]);
    const result = await runAgentTurn([{ role: 'user', content: 'Best Unknown Player NFL props' }]);
    expect(result.reply).toContain('Which NFL player');
    expect(result.results).toEqual([]);
    expect(result.toolTrace).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(runNFLFinderDeepSearch).not.toHaveBeenCalled();
  });

  it('does not guess when multiple NFL players share a surname', async () => {
    vi.mocked(searchNFLPlayers).mockResolvedValue([{ ...player, name: 'Josh Allen' }, { ...player, id: 2, name: 'Kyle Allen' }]);
    const context = createAgentContext();
    applyRequestScope(context, 'Best Allen NFL props', '2026-10-04');
    expect(await prepareNFLRequestScope(context)).toContain('Which NFL player');
    expect(runNFLFinderDeepSearch).not.toHaveBeenCalled();
  });

  it('does not accept a lone unrelated search result as a confident match', async () => {
    const context = createAgentContext();
    applyRequestScope(context, 'Best Fictional NFL props', '2026-10-04');
    expect(await prepareNFLRequestScope(context)).toContain('Which NFL player');
    expect(runNFLFinderDeepSearch).not.toHaveBeenCalled();
  });

  it('pins an undated player request to their upcoming game rather than the model\'s date', async () => {
    vi.mocked(getNFLUpcomingGameDate).mockResolvedValue('2026-10-11');
    const context = createAgentContext();
    applyRequestScope(context, 'Best Mahomes props');
    expect(await prepareNFLRequestScope(context)).toBeNull();
    expect(context.canonicalDate?.resolvedDate).toBe('2026-10-11');
    expect(getNFLUpcomingGameDate).toHaveBeenCalledWith([12]);
    expect(runNFLFinderDeepSearch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves an explicit requested date', async () => {
    const context = createAgentContext();
    applyRequestScope(context, 'Best Mahomes props Sunday', '2026-10-04');
    await prepareNFLRequestScope(context);
    expect(context.canonicalDate?.resolvedDate).toBe('2026-10-04');
    expect(getNFLUpcomingGameDate).not.toHaveBeenCalled();
  });

  it('cannot reuse an older slate after resolving the player\'s upcoming date', async () => {
    vi.mocked(getResearchSession).mockResolvedValueOnce({
      sport: 'nfl', date: '2026-10-04', candidates: [{
        candidateId: 'old', playerId: player.id, teamId: 12, player: player.name, team: 'Kansas City Chiefs', opponent: 'Las Vegas Raiders',
        marketKey: 'player_pass_yds', market: 'Passing Yards', odds: -110, eliteQualified: true, researchScore: 90,
      }], toolMeta: {},
    } as never);
    vi.mocked(getNFLUpcomingGameDate).mockResolvedValue('2026-10-11');
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => ({ output: [] }) } as Response);
    const result = await runAgentTurn([{ role: 'user', content: 'Best Mahomes props' }], 'old');
    expect(fetch).not.toHaveBeenCalled();
    expect(result.results).toEqual([]);
    expect(result.meta?.reusedExistingSession).not.toBe(true);
    expect(runNFLFinderDeepSearch).toHaveBeenCalledTimes(2);
    expect(runNFLFinderDeepSearch).toHaveBeenNthCalledWith(2, '2026-10-11', { validationGameIds: ['chiefs'], playerId: player.id });
  });
});

describe('NFL matchup scope before sportsbook loading', () => {
  it('infers NFL from Chiefs vs Raiders and restricts finder game IDs', async () => {
    const context = createAgentContext();
    applyRequestScope(context, 'Best Chiefs vs Raiders props', '2026-10-04');
    vi.mocked(runNFLFinderDeepSearch).mockResolvedValueOnce(preflight() as never).mockResolvedValueOnce({ propsAnalyzed: 0, nflCandidates: [] } as never);
    await executeTool('get_sportsbook_candidates', { sport: 'mlb', date: '2026-10-04' }, context);
    expect(context.canonicalSport).toBe('nfl');
    expect(runNFLFinderDeepSearch).toHaveBeenNthCalledWith(2, '2026-10-04', { validationGameIds: ['chiefs'] });
    expect(searchNFLPlayers).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('does not replace an unavailable matchup with either team\'s unrelated game', async () => {
    const context = createAgentContext();
    applyRequestScope(context, 'Best Chiefs vs Dolphins props', '2026-10-04');
    const result = await executeTool('get_sportsbook_candidates', { sport: 'nfl', date: '2026-10-04' }, context);
    expect(result.status).toBe('NOT_FOUND');
    expect(runNFLFinderDeepSearch).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never turns an empty cached scope into an unrestricted finder run', async () => {
    vi.mocked(runNFLFinderDeepSearch).mockResolvedValue(preflight(true) as never);
    const context = createAgentContext();
    applyRequestScope(context, 'Best Chiefs vs Raiders props', '2026-10-04');
    const result = await executeTool('get_sportsbook_candidates', { sport: 'nfl', date: '2026-10-04' }, context);
    expect(result.status).toBe('RESEARCH_INCOMPLETE');
    expect(runNFLFinderDeepSearch).toHaveBeenCalledTimes(2);
    expect(runNFLFinderDeepSearch).toHaveBeenNthCalledWith(2, '2026-10-04', { validationGameIds: ['chiefs'] });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('Stage 3 clean NFL request outcomes', () => {
  function summary(researchComplete: boolean) {
    return { ...preflight(), propsAnalyzed: 0, nflCandidates: [], gamesAnalyzed: 0, fromCache: true,
      nflLedger: { sport: 'nfl', date: '2026-10-11', eligiblePregame: 14, expectedGames: 14, researchComplete,
        retrievedGames: researchComplete ? 14 : 0, zeroMarketGames: 0, researchedGames: researchComplete ? 14 : 0,
        failedGames: researchComplete ? 0 : 1, notFetchedGames: 0,
        games: [{ gameId: 'one', state: researchComplete ? 'RESEARCHED' : 'FAILED', failure: researchComplete ? null : 'AUTHENTICATION' }] } };
  }

  it('returns complete zero-pick research successfully without a model or authorization', async () => {
    vi.mocked(runNFLFinderDeepSearch).mockResolvedValueOnce(preflight() as never).mockResolvedValueOnce(summary(true) as never);
    const result = await runAgentTurn([{ role: 'user', content: 'Give me the best NFL props 2026-10-11' }]);
    expect(result.meta?.researchComplete).toBe(true); expect(result.results).toEqual([]);
    expect(result.reply).toContain('publication requirements and requested quality floor'); expect(fetch).not.toHaveBeenCalled();
    expect(result.closestMisses).toEqual([]); expect(result.toolTrace).toEqual([]);
  });

  it('returns incomplete research, not zero Elite picks, when one required game failed', async () => {
    vi.mocked(runNFLFinderDeepSearch).mockResolvedValueOnce(preflight() as never).mockResolvedValueOnce(summary(false) as never);
    const result = toClientResult(await runAgentTurn([{ role: 'user', content: 'Best NFL props 2026-10-11' }]), false);
    expect(result.meta?.researchComplete).toBe(false); expect(result.results).toEqual([]);
    expect(result.reply).toBe('Required NFL sportsbook market data is currently unavailable.');
    expect(JSON.stringify(result)).not.toMatch(/AUTHENTICATION|oddsSpend|credits|function|provider/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns incomplete research when every successfully retrieved game has zero markets', async () => {
    const empty = summary(false);
    empty.nflLedger.retrievedGames = 14;
    empty.nflLedger.zeroMarketGames = 14;
    empty.nflLedger.failedGames = 0;
    empty.nflLedger.notFetchedGames = 0;
    empty.nflLedger.games = Array.from({ length: 14 }, (_, index) => ({ gameId: String(index), state: 'ZERO_MARKETS', failure: null }));
    vi.mocked(runNFLFinderDeepSearch).mockResolvedValueOnce(preflight() as never).mockResolvedValueOnce(empty as never);
    const result = toClientResult(await runAgentTurn([{ role: 'user', content: 'Give me the best NFL props 2026-10-11' }]), false);
    expect(result.meta?.status).toBe('RESEARCH_INCOMPLETE');
    expect(result.meta?.researchComplete).toBe(false);
    expect(result.results).toEqual([]);
    expect(result.researchSessionId).toBeNull();
    expect(result.reply).toBe('NFL sportsbook player-prop markets have not been posted for this slate yet.');
    expect(result.toolTrace).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['tennis', 'mls'])('does not let %s inherit the generic MLB research engine', async (sport) => {
    const context = createAgentContext();
    const result = await executeTool('get_sportsbook_candidates', { sport, date: '2026-10-11' }, context);
    expect(result.status).toBe('SPORT_UNAVAILABLE');
    expect(runNFLFinderDeepSearch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('only passes supported receiving markets for a receiving Chiefs-Raiders request', async () => {
    vi.mocked(runNFLFinderDeepSearch).mockResolvedValueOnce(preflight() as never).mockResolvedValueOnce(summary(true) as never);
    await runAgentTurn([{ role: 'user', content: 'Best receiving props Chiefs vs Raiders 2026-10-11' }]);
    expect(runNFLFinderDeepSearch).toHaveBeenNthCalledWith(2, '2026-10-11', { validationGameIds: ['chiefs'], marketKeys: ['player_reception_yds', 'player_receptions', 'player_reception_tds'] });
  });
});