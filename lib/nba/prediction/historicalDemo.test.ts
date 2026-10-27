import { describe, expect, it } from 'vitest';
import { buildNBAHistoricalDemo, NBA_DEMO_MARKET_IDS } from './historicalDemo';
import { DEFAULT_NBA_RESEARCH_FILTER, NBA_RESEARCH_MARKETS } from '../researchMarkets';

describe('isolated NBA synthetic UI demo', () => {
  it('covers exactly the 26 verified contract identities without claiming provider data', () => {
    const presentation = buildNBAHistoricalDemo(DEFAULT_NBA_RESEARCH_FILTER);
    expect(new Set(presentation.picks.map(pick => pick.subject.market.key))).toEqual(new Set(NBA_DEMO_MARKET_IDS));
    expect(presentation.picks.every(pick => pick.disposition === 'RESEARCH_ONLY' && pick.tierDecision == null)).toBe(true);
    expect(presentation.recommendedCandidateIds).toEqual([]);
    expect(presentation.picks.every(pick => pick.pricing.state === 'UNPRICED' && pick.pricing.sportsbook == null
      && pick.metrics.trueProbability == null && pick.metrics.evPercent == null && pick.metrics.researchScore == null)).toBe(true);
    expect(presentation.picks.every(pick => pick.missing.some(reason => reason.includes('SYNTHETIC TEST FIXTURE ONLY')))).toBe(true);
    expect(NBA_RESEARCH_MARKETS).toHaveLength(41);
  });
  it('honors selected market and side filters without substituting an unsupported market', () => {
    const selected = buildNBAHistoricalDemo({ ...DEFAULT_NBA_RESEARCH_FILTER, marketIds: ['player_points_q1', 'dunks'], sides: ['under'] });
    expect(selected.picks).toHaveLength(1);
    expect(selected.picks[0].subject.market).toMatchObject({ key: 'player_points_q1', side: 'under', label: expect.stringContaining('1Q') });
  });
  it('labels every alternate and quarter contract distinctly from standard full-game lines', () => {
    const presentation = buildNBAHistoricalDemo(DEFAULT_NBA_RESEARCH_FILTER);
    for (const id of ['alternate_spreads', 'alternate_totals', 'alternate_team_totals', 'h2h_q1', 'spreads_q1', 'totals_q1', 'player_points_q1']) {
      expect(presentation.picks.find(pick => pick.subject.market.key === id)?.subject.market.label).toContain(id.startsWith('alternate_') ? 'Alternate' : '1Q');
    }
  });
});