import type { PickPresentation, PickPresentationInput } from '../presentation';
import { NBA_RESEARCH_MARKETS, type NBAResearchFilter } from '../researchMarkets';

export type NBAHistoricalDemoPresentation = PickPresentation & { recommendedCandidateIds: string[] };

export const NBA_DEMO_MARKET_IDS = [
  'h2h', 'spreads', 'totals', 'team_totals', 'alternate_spreads', 'alternate_totals', 'alternate_team_totals',
  'player_points', 'player_threes', 'player_points_rebounds_assists', 'player_points_rebounds', 'player_points_assists',
  'player_rebounds_assists', 'player_blocks_steals', 'player_rebounds', 'player_assists', 'player_steals', 'player_blocks',
  'player_double_double', 'player_triple_double', 'h2h_q1', 'spreads_q1', 'totals_q1', 'player_points_q1',
  'player_rebounds_q1', 'player_assists_q1',
] as const;

const MOCK_LINES: Record<string, number | null> = {
  h2h: null, spreads: -2.5, totals: 220.5, team_totals: 112.5,
  alternate_spreads: -4.5, alternate_totals: 218.5, alternate_team_totals: 110.5,
  player_points: 20.5, player_threes: 2.5, player_points_rebounds_assists: 32.5,
  player_points_rebounds: 27.5, player_points_assists: 26.5, player_rebounds_assists: 12.5,
  player_blocks_steals: 2.5, player_rebounds: 8.5, player_assists: 5.5, player_steals: 1.5, player_blocks: 1.5,
  player_double_double: 0.5, player_triple_double: 0.5,
  h2h_q1: null, spreads_q1: -0.5, totals_q1: 55.5, player_points_q1: 5.5, player_rebounds_q1: 1.5, player_assists_q1: 1.5,
};

function demoInput(marketId: typeof NBA_DEMO_MARKET_IDS[number], filter: NBAResearchFilter, side: 'over' | 'under'): PickPresentationInput | null {
  const market = NBA_RESEARCH_MARKETS.find(entry => entry.id === marketId);
  if (!market || filter.marketIds != null && !filter.marketIds.includes(marketId)) return null;
  const binary = marketId === 'player_double_double' || marketId === 'player_triple_double';
  const label = `${market.label}${marketId.endsWith('_q1') ? ' · 1Q' : ''}${marketId.startsWith('alternate_') ? ' · Alternate line' : ''}${binary ? ' · Yes/No mock' : ''}`;
  const line = MOCK_LINES[marketId] ?? null;
  const outcome = binary ? side === 'over' ? 'Yes' : 'No' : side === 'over' ? 'Over' : 'Under';
  const gameLine = market.category === 'Team';
  const moneyline = marketId === 'h2h' || marketId === 'h2h_q1';
  const spread = marketId.includes('spreads');
  const teamTotal = marketId.includes('team_totals');
  const marketType = moneyline ? 'MONEYLINE' : spread ? 'SPREAD' : teamTotal ? 'TEAM_TOTAL' : 'TOTAL';
  const gameSelection: 'HOME' | 'OVER' | 'UNDER' = moneyline || spread ? 'HOME' : outcome === 'Over' ? 'OVER' : 'UNDER';
  const subject: PickPresentationInput['subject'] = gameLine
    ? { kind: 'GAME_LINE', gameId: 'DEMO-NOT-A-REAL-GAME', home: { id: null, name: 'Demo Home (fixture)' }, away: { id: null, name: 'Demo Away (fixture)' },
      market: { key: marketId, label, type: marketType, line, selection: gameSelection, team: moneyline || spread || teamTotal ? 'HOME' : null } }
    : { kind: 'PLAYER_PROP', gameId: 'DEMO-NOT-A-REAL-GAME', player: { id: null, name: 'Demo Player (fixture)', team: 'Demo Home (fixture)' },
      market: { key: marketId, label, line, side } };
  return { candidateId: `demo.${marketId}.${side}`, subject, tierDecision: null, sportsbook: null, americanOdds: null, quoteStatus: 'UNAVAILABLE',
    trueProbability: null, modelProbability: null, evPercent: null, researchScore: null, seasonPhase: null, seasonPhaseCertainty: 'MISSING',
    missing: ['SYNTHETIC TEST FIXTURE ONLY. Not sourced from a sportsbook, historical game, or live NBA event. No wager price or model result.'],
    researchEvidence: [{ id: 'demo-fixture', category: 'TEST_DATA', source: null,
      detail: `Synthetic UI contract example for ${marketId}; fixture line ${line ?? 'not applicable'}; outcome ${outcome}. Test values only, not a quoted or historical sportsbook selection.`,
      observedAt: null, stance: 'CONTEXT' }] };
}

export function buildNBAHistoricalDemo(filter: NBAResearchFilter): NBAHistoricalDemoPresentation {
  const picks = NBA_DEMO_MARKET_IDS.flatMap(id => {
    const category = NBA_RESEARCH_MARKETS.find(market => market.id === id)?.category;
    const sides = category === 'Team' ? ['over'] as const : filter.sides;
    const markets = sides.map(side => demoInput(id, filter, side)).filter((input): input is PickPresentationInput => input != null);
    return markets;
  });
  return { schemaVersion: 'deepside-nba-pick-presentation/1', outcome: 'RESEARCH_ONLY', requestedSort: filter.ranking,
    sortStatus: 'SOURCE_ORDER', picks: picks.map(input => ({ candidateId: input.candidateId, subject: input.subject,
      tierDecision: null, disposition: 'RESEARCH_ONLY', pricing: { state: 'UNPRICED', sportsbook: null, americanOdds: null, quoteStatus: 'UNAVAILABLE' },
      metrics: { trueProbability: null, modelProbability: null, evPercent: null, researchScore: null, tierScore: null },
      season: { phase: null, certainty: 'MISSING', reason: 'Synthetic interface fixture only; no event or history was queried.' },
      researchEvidence: [...(input.researchEvidence ?? [])], missing: [...(input.missing ?? [])] })),
    recommendedCandidateIds: [],
  };
}