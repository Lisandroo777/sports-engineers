import { describe, expect, it } from 'vitest';
import { detectRequestedGames } from './tools';
import { rankCachedSession, toClientResult, type AgentTurnResult } from './runner';
import type { ResearchSession } from './session';

const NFL_SUNDAY = [
  { gameId: 'g1', matchup: 'Indianapolis Colts @ Washington Commanders' },
  { gameId: 'g2', matchup: 'Kansas City Chiefs @ Buffalo Bills' },
  { gameId: 'g3', matchup: 'Los Angeles Rams @ San Francisco 49ers' },
];
const injuryTimestamp = new Date().toISOString();
const freshNFLInjury = { player: { player: 'P', playerId: 1, teamId: 18, team: 'Indianapolis Colts', position: 'QB',
  injury: null, status: 'Active', availabilityDesignation: 'CONFIRMED_AVAILABLE' as const, updatedAt: injuryTimestamp, sourceStatus: 'CURRENT' as const,
  evidence: null, affectedRole: 'PLAYER' as const, missingFields: [] }, team: 'Indianapolis Colts', teammateAbsences: [], opponentAbsences: [],
  sourceStatus: { provider: 'ESPN' as const, status: 'CURRENT' as const }, lastUpdated: injuryTimestamp, missingFields: [] };

describe('request scope decides which games get refreshed', () => {
  it('a sport/date request covers the complete slate', () => {
    expect(detectRequestedGames('Best NFL plays Sunday', NFL_SUNDAY)).toEqual([]);
  });

  it('a single-game request refreshes only that event', () => {
    expect(detectRequestedGames('Best props Colts vs Commanders', NFL_SUNDAY)).toEqual(['g1']);
    expect(detectRequestedGames('Best props for Chiefs vs Bills', NFL_SUNDAY)).toEqual(['g2']);
  });

  it('a single team scopes to that team\'s game', () => {
    expect(detectRequestedGames('Best 49ers props', NFL_SUNDAY)).toEqual(['g3']);
  });

  it('matches whole words only', () => {
    expect(detectRequestedGames('Jalen Ramsey tackles', NFL_SUNDAY)).toEqual([]);
  });
});

describe('a single-game session never answers a whole-slate request', () => {
  const candidate = { candidateId: 'x', player: 'P', playerId: 1, teamId: 18, team: 'Indianapolis Colts', opponent: 'Washington Commanders', market: 'Passing Yards', marketKey: 'player_pass_yds', direction: 'over', odds: -110, priceCurrent: true, priceFreshness: 'FRESH', injuryContext: freshNFLInjury, eliteQualified: true, researchScore: 90, rejectionReasons: [] };
  const scoped = { sport: 'nfl', date: '2026-10-04', queryIntent: '', generatedAt: '', toolMeta: {}, candidates: [candidate], scopeGameIds: ['g1'] } as unknown as ResearchSession;

  it('falls through to fresh research for a broader request', () => {
    expect(rankCachedSession(scoped, 'Best NFL plays Sunday', 's')).toBeNull();
  });

  it('still re-ranks within the same game', () => {
    expect(rankCachedSession(scoped, 'Best Colts props', 's')).not.toBeNull();
  });
});

describe('provider credit data never reaches the production client', () => {
  const result: AgentTurnResult = {
    reply: '', results: [], closestMisses: [], researchSessionId: null,
    meta: { sport: 'nfl', date: '2026-10-04', gamesFound: 14, gamesScheduled: 14, oddsSpend: { creditsSpent: 366 }, credits: { remaining: '19634' }, sportsbookPreflight: { estimatedCreditCostHigh: 854 } },
    toolTrace: [{ name: 'get_sportsbook_candidates', status: 'SUCCESS', summary: { oddsSpend: { creditsSpent: 366 } } }],
  };

  it('strips credit/cost fields in production but keeps coverage', () => {
    const client = toClientResult(result, true);
    expect(client.meta).toEqual({ sport: 'nfl', date: '2026-10-04', gamesFound: 14, gamesScheduled: 14 });
    expect(JSON.stringify(client)).not.toMatch(/credit|oddsSpend|sportsbookPreflight/i);
  });

  it('keeps diagnostics in development', () => {
    expect(JSON.stringify(toClientResult(result, false))).not.toMatch(/credits|oddsSpend|sportsbookPreflight/);
  });
});
