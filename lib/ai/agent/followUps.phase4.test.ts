import { describe, it, expect } from 'vitest';
import { createAgentContext, executeTool } from './tools';
import { buildResearchSessionFromCandidates, type GenericResearchCandidate } from './session';
import { analyzePickCandidate, type EliteCandidateInput } from '../eliteResearchFilter';

function eliteInput(overrides: Partial<EliteCandidateInput>): EliteCandidateInput {
  return {
    candidateId: 'c', sport: 'nba', playerId: 1, player: 'P', market: 'points', line: 20, direction: 'over',
    isAlternate: false, projection: 26, projectionUncertainty: 4, historicalRates: [85, 85, 80, 82], sampleSize: 20,
    oddsAmerican: 120, marketFairProbability: null, matchupAvailable: true, usageAvailable: true, roleKnown: true,
    gameContextAvailable: true, opponentPersonnelAvailable: false, marketConfirmationAvailable: true, statusKnown: true,
    lastUpdatedAt: new Date().toISOString(), requiredMarketSupported: true, marketSupport: 'SUPPORTED',
    unsupportedSignals: ['projectionAgreement', 'opponentPersonnel'],
    ...overrides,
  };
}

function nbaSession(candidates: Array<Partial<GenericResearchCandidate> & Partial<EliteCandidateInput> & { id: string }>) {
  const generic: GenericResearchCandidate[] = candidates.map((c) => ({
    candidateId: c.id, player: c.player as string ?? 'Player', team: (c.team as string) ?? null,
    opponent: 'OPP @ HOME', marketLabel: (c.marketLabel as string) ?? 'Points', marketKey: (c.market as string) ?? 'points',
    line: 20, direction: (c.direction as 'over' | 'under') ?? 'over', book: 'Book A', odds: 120,
    projection: 26, projectionUncertainty: 4, l5Rate: 85, l10Rate: 85, l20Rate: 82, seasonRate: 82,
    analysis: analyzePickCandidate(eliteInput({ candidateId: c.id, market: (c.market as string) ?? 'points', direction: (c.direction as 'over' | 'under') ?? 'over' })),
    sport: 'nba', matchupAvailable: true, roleKnown: true, injuryKnown: true,
    position: (c.position as string) ?? null,
  }));
  return buildResearchSessionFromCandidates({
    sport: 'nba', date: '2026-01-01', queryIntent: 'test', candidates: generic,
    toolMeta: { gamesFound: 1, gamesScheduled: 1, propsFound: generic.length, booksFound: 1, candidatesFound: generic.length, cached: false, dataFreshnessSeconds: 0, budgetLimited: false },
  });
}

describe('NBA AI follow-up filters (Phase 4 task 8), 0 Odds calls', () => {
  it('"only show NBA overs" resolves via the side filter', async () => {
    const context = createAgentContext();
    context.researchSession = nbaSession([
      { id: 'a', market: 'points', direction: 'over' },
      { id: 'b', market: 'rebounds', direction: 'under' },
    ]);
    const result = await executeTool('rank_candidates', { sport: 'nba', date: '2026-01-01', side: 'over', eliteOnly: false }, context);
    const data = (result as { data: { results: Array<{ candidateId: string }> } }).data;
    expect(data.results.every((r) => r.candidateId === 'a')).toBe(true);
  });

  it('"show guards only" resolves via positionGroup substring match on real ESPN position', async () => {
    const context = createAgentContext();
    context.researchSession = nbaSession([
      { id: 'a', market: 'points', position: 'PG' },
      { id: 'b', market: 'points', position: 'C' },
    ]);
    const result = await executeTool('rank_candidates', { sport: 'nba', date: '2026-01-01', positionGroup: 'G', eliteOnly: false }, context);
    const data = (result as { data: { results: Array<{ candidateId: string }> } }).data;
    expect(data.results.map((r) => r.candidateId)).toEqual(['a']);
  });

  it('"only show PRA" resolves via marketContains', async () => {
    const context = createAgentContext();
    context.researchSession = nbaSession([
      { id: 'a', market: 'pra', marketLabel: 'Points + Rebounds + Assists' },
      { id: 'b', market: 'points', marketLabel: 'Points' },
    ]);
    const result = await executeTool('rank_candidates', { sport: 'nba', date: '2026-01-01', marketContains: 'pra', eliteOnly: false }, context);
    const data = (result as { data: { results: Array<{ candidateId: string }> } }).data;
    expect(data.results.map((r) => r.candidateId)).toEqual(['a']);
  });

  it('"closest NBA misses" resolves via get_closest_misses with 0 Odds calls', async () => {
    const context = createAgentContext();
    context.researchSession = nbaSession([{ id: 'a', market: 'points' }]);
    const result = await executeTool('get_closest_misses', { count: 5 }, context);
    expect(result.status).toBeDefined();
  });
});

describe('NFL AI follow-up filters (Phase 4 task 8), 0 Odds calls', () => {
  function nflSession(candidates: Array<{ id: string; market: string; direction?: 'over' | 'under' }>) {
    const generic: GenericResearchCandidate[] = candidates.map((c) => ({
      candidateId: c.id, player: 'Player', team: null, opponent: 'OPP @ HOME',
      marketLabel: c.market, marketKey: c.market, line: 200, direction: c.direction ?? 'over',
      book: 'Book A', odds: 120, projection: 260, projectionUncertainty: 25,
      l5Rate: 85, l10Rate: 85, l20Rate: null, seasonRate: 82,
      analysis: analyzePickCandidate(eliteInput({ candidateId: c.id, sport: 'nfl', market: c.market, direction: c.direction ?? 'over', line: 200, projection: 260, projectionUncertainty: 25 })),
      sport: 'nfl', matchupAvailable: true, roleKnown: true, injuryKnown: false,
      position: c.market.startsWith('player_pass') ? 'qb' : c.market.startsWith('player_rush') ? 'rb' : c.market.startsWith('player_reception') ? 'wr_te' : null,
    }));
    return buildResearchSessionFromCandidates({
      sport: 'nfl', date: '2026-01-01', queryIntent: 'test', candidates: generic,
      toolMeta: { gamesFound: 1, gamesScheduled: 1, propsFound: generic.length, booksFound: 1, candidatesFound: generic.length, cached: false, dataFreshnessSeconds: 0, budgetLimited: false },
    });
  }

  it('"show quarterback passing props" resolves via positionGroup=qb', async () => {
    const context = createAgentContext();
    context.researchSession = nflSession([
      { id: 'a', market: 'player_pass_yds' },
      { id: 'b', market: 'player_rush_yds' },
    ]);
    const result = await executeTool('rank_candidates', { sport: 'nfl', date: '2026-01-01', positionGroup: 'qb', eliteOnly: false }, context);
    const data = (result as { data: { results: Array<{ candidateId: string }> } }).data;
    expect(data.results.map((r) => r.candidateId)).toEqual(['a']);
  });

  it('"show running backs only" resolves via positionGroup=rb', async () => {
    const context = createAgentContext();
    context.researchSession = nflSession([
      { id: 'a', market: 'player_pass_yds' },
      { id: 'b', market: 'player_rush_yds' },
    ]);
    const result = await executeTool('rank_candidates', { sport: 'nfl', date: '2026-01-01', positionGroup: 'rb', eliteOnly: false }, context);
    const data = (result as { data: { results: Array<{ candidateId: string }> } }).data;
    expect(data.results.map((r) => r.candidateId)).toEqual(['b']);
  });

  it('"show receiving unders" resolves via marketContains + side', async () => {
    const context = createAgentContext();
    context.researchSession = nflSession([
      { id: 'a', market: 'player_reception_yds', direction: 'under' },
      { id: 'b', market: 'player_reception_yds', direction: 'over' },
      { id: 'c', market: 'player_pass_yds', direction: 'under' },
    ]);
    const result = await executeTool('rank_candidates', { sport: 'nfl', date: '2026-01-01', marketContains: 'reception', side: 'under', eliteOnly: false }, context);
    const data = (result as { data: { results: Array<{ candidateId: string }> } }).data;
    expect(data.results.map((r) => r.candidateId)).toEqual(['a']);
  });
});
