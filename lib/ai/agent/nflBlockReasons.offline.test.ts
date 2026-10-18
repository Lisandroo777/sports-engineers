import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { finishNFLSlateLedger, type NFLGameLedger, type NFLSlateLedger } from '../../nfl/slateLedger';
import type { NFLProviderFailure } from '../../nfl/sportsbook';
import { toClientResult, type AgentTurnResult } from './runner';

function createLedger(failures: NFLProviderFailure[], researchedGames = 0): NFLSlateLedger {
  return finishNFLSlateLedger({ sport: 'nfl', date: '2026-10-18',
    requestedMarkets: ['player_pass_yds', 'player_pass_attempts'],
    games: Array.from({ length: researchedGames + failures.length }, (_, index): NFLGameLedger => {
      const researched = index < researchedGames;
      return {
        gameId: `game-${index}`, eventId: researched ? `event-${index}` : null,
        matchup: `Away ${index} @ Home ${index}`, kickoff: '2026-10-18T20:00:00Z', eligibility: 'PREGAME',
        state: researched ? 'RESEARCHED' : 'FAILED',
        returnedMarkets: researched ? ['player_pass_yds'] : [],
        zeroMarkets: researched ? ['player_pass_attempts'] : [],
        failedMarkets: researched ? [] : ['player_pass_yds', 'player_pass_attempts'],
        retrievedAt: researched ? '2026-10-18T12:00:00Z' : null,
        expiresAt: researched ? Date.parse('2026-10-18T12:10:00Z') : null,
        failure: researched ? null : failures[index - researchedGames],
        propsEvaluated: researched ? 1 : 0, fromCache: true,
      };
    }),
  });
}

function clientResult(ledger: NFLSlateLedger, production = true) {
  const turn: AgentTurnResult = { reply: 'Research incomplete.', results: [], closestMisses: [],
    meta: { sport: 'nfl', researchComplete: ledger.researchComplete, nflLedger: ledger,
      rawError: 'private provider error: account=secret; spending=123.45' },
    toolTrace: [], researchSessionId: null };
  return toClientResult(turn, production);
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden in NFL blocker tests'); }));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

describe('precise NFL no-results blockers (offline)', () => {
  it.each([
    ['CREDIT_BALANCE_UNKNOWN', 'NFL refresh could not verify the current provider credit balance. No new sportsbook request was made.'],
    ['DAILY_LIMIT', 'NFL research reached its configured refresh limit; an authorized refresh is required to research the remaining games.'],
    ['SEARCH_LIMIT', 'NFL research reached its configured refresh limit; an authorized refresh is required to research the remaining games.'],
    ['REFRESH_UNAVAILABLE', 'NFL refresh verification is currently unavailable. Current market coverage could not be confirmed.'],
    ['REFRESH_NOT_AUTHORIZED', 'NFL sportsbook refresh was not authorized. An authorized refresh is required to research the remaining games.'],
    ['CACHE_ONLY', 'No fresh cached NFL sportsbook data is available for the remaining games. An authorized refresh is required.'],
    ['RATE_LIMIT', 'NFL sportsbook refresh reached a request rate limit. Research remains incomplete.'],
  ] as const)('explains %s from actual game failures with no results', (failure, reason) => {
    for (const production of [true, false]) {
      const result = clientResult(createLedger([failure]), production);
      expect(result.reply).toBe(reason);
      expect(result.results).toEqual([]);
      expect(result.reply).not.toMatch(/outage|not been posted|no supported markets|private|secret|123\.45/);
      expect(result.reply).not.toContain(failure);
    }
  });

  it('keeps partial counts and all distinct blockers without claiming the remaining markets were checked', () => {
    const ledger = createLedger(['CREDIT_BALANCE_UNKNOWN', 'DAILY_LIMIT', 'SEARCH_LIMIT', 'CACHE_ONLY'], 1);
    const original = structuredClone(ledger);
    const result = clientResult(ledger);
    expect(result.reply).toContain('Partial NFL coverage: 1/5 pregame games researched.');
    expect(result.reply).toContain('No independently qualified picks from the fully researched games are currently available');
    expect(result.reply).toContain('other games remain unchecked.');
    expect(result.reply).toContain('NFL refresh could not verify the current provider credit balance.');
    expect(result.reply.match(/configured refresh limit/g)).toHaveLength(1);
    expect(result.reply).toContain('No fresh cached NFL sportsbook data is available for the remaining games.');
    expect(result.reply).not.toMatch(/not been posted|outage|Only independently qualified picks/);
    expect(result.results).toEqual([]);
    expect(ledger).toEqual(original);
  });

  it('reports unposted markets only when every eligible game was successfully checked and empty', () => {
    const source = createLedger(['NETWORK', 'NETWORK']);
    const ledger = finishNFLSlateLedger({ ...source, games: source.games.map((game) => ({ ...game,
      state: 'ZERO_MARKETS', failure: null, failedMarkets: [], zeroMarkets: [...source.requestedMarkets],
      retrievedAt: '2026-10-18T12:00:00Z', expiresAt: Date.parse('2026-10-18T12:10:00Z'),
    })) });
    expect(clientResult(ledger).reply).toBe('NFL sportsbook player-prop markets have not been posted for this slate yet.');
    const partial = finishNFLSlateLedger({ ...ledger, games: [ledger.games[0], {
      ...createLedger(['CACHE_ONLY']).games[0], gameId: ledger.games[1].gameId, matchup: ledger.games[1].matchup,
    }] });
    expect(clientResult(partial).reply).toContain('An authorized refresh is required.');
    expect(clientResult(partial).reply).not.toContain('not been posted');
  });

  it('does not infer an empty slate from missing markets or an unrelated started-game blocker', () => {
    const source = createLedger(['RESEARCH_FAILED', 'CREDIT_BALANCE_UNKNOWN']);
    const ledger = finishNFLSlateLedger({ ...source, games: [
      { ...source.games[0], returnedMarkets: ['player_pass_yds'], failedMarkets: ['player_pass_attempts'],
        retrievedAt: '2026-10-18T12:00:00Z' },
      { ...source.games[1], eligibility: 'STARTED' },
    ] });
    expect(clientResult(ledger).reply).toBe('Required NFL sportsbook market data is currently unavailable.');
  });
});