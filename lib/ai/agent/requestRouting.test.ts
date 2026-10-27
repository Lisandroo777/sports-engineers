import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { crossSportScope, runAgentTurn } from './runner';
import { executeTool } from './tools';
import { runNBAFinderDeepSearch } from '../../finder/nbaEngine';
import { NBA_VERIFIED_RESEARCH_MARKETS } from '../../nba/prediction/researchReceipt';

vi.mock('./tools', async original => ({
  ...await original<typeof import('./tools')>(),
  executeTool: vi.fn(async (_name, args) => ({ status: 'NO_GAMES_SCHEDULED', sport: args.sport, date: args.date })),
  prepareNFLRequestScope: vi.fn(async () => null),
}));
vi.mock('./sessionStore', () => ({ getResearchSession: vi.fn(async () => null), saveResearchSession: vi.fn(async () => 'routing-session') }));
vi.mock('../../finder/nbaEngine', () => ({ runNBAFinderDeepSearch: vi.fn(async () => ({
  nbaCandidates: [], gameCandidates: [], modeledGames: [], gamesAnalyzed: 0, gamesScheduled: 0,
  propsAnalyzed: 0, booksAnalyzed: 0, fromCache: false, cacheAgeMs: null, budgetLimited: false,
})) }));
vi.mock('../../nba/prediction/gameLines/cachedEventResearch', () => ({ loadCachedNBAEventResearch: vi.fn(async () => []) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-14T16:00:00Z'));
  vi.stubEnv('OPENAI_API_KEY', '');
  vi.stubEnv('ODDS_AUTO_REFRESH', 'false');
  vi.stubEnv('ODDS_ALLOW_PAID_REFRESH', 'false');
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Network forbidden in routing tests'); }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('research routing before provider access', () => {
  it.each(['Best picks today', 'Find the best picks for today', 'Show me the safest plays tonight'])('routes %s through all connected research engines', async query => {
    const result = await runAgentTurn([{ role: 'user', content: query }], null, null, { sport: 'nfl', date: '2026-10-14' });
    expect(executeTool).toHaveBeenCalledWith('get_sportsbook_candidates', { sport: 'mlb', date: '2026-10-14' }, expect.anything());
    expect(executeTool).toHaveBeenCalledWith('get_sportsbook_candidates', { sport: 'nfl', date: '2026-10-14' }, expect.anything());
    expect(runNBAFinderDeepSearch).toHaveBeenCalledWith('2026-10-14', expect.objectContaining({ gameLines: true, researchMarkets: NBA_VERIFIED_RESEARCH_MARKETS }));
    expect(result.meta?.sport).toBe('all');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['nfl', 'mlb'])('routes an entire %s request only to that sport on the explicit date', async sport => {
    await runAgentTurn([{ role: 'user', content: `Find the best ${sport.toUpperCase()} picks on 2026-10-15` }]);
    expect(executeTool).toHaveBeenCalledExactlyOnceWith('get_sportsbook_candidates', { sport, date: '2026-10-15' }, expect.anything());
    expect(runNBAFinderDeepSearch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('routes a whole NBA request only to the NBA engine without game restrictions', async () => {
    await runAgentTurn([{ role: 'user', content: 'Find the best NBA picks on 2026-10-15' }]);
    expect(runNBAFinderDeepSearch).toHaveBeenCalledTimes(1);
    expect(runNBAFinderDeepSearch).toHaveBeenCalledWith('2026-10-15', expect.objectContaining({
      gameLines: true, gameLinesOnly: false, researchMarkets: NBA_VERIFIED_RESEARCH_MARKETS }));
    expect(vi.mocked(runNBAFinderDeepSearch).mock.calls[0][1]).not.toHaveProperty('validationGameIds');
    expect(executeTool).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['Best Chiefs vs Raiders picks today', 'Best Lakers vs Celtics picks today', 'Best picks for Patrick Mahomes today', 'Refresh those picks'])('does not treat scoped or follow-up query %s as all sports', query => {
    expect(crossSportScope(query)).toEqual([]);
  });
});