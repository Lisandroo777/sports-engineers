import { describe, expect, it } from 'vitest';
import { planNBAResearch } from './researchPreflight';
import { NBA_VERIFIED_RESEARCH_MARKETS } from './researchReceipt';

const event = { id: '0123456789abcdef0123456789abcdef', commenceTime: '2026-01-21T23:00:00Z', homeTeam: 'Home', awayTeam: 'Away' };
const now = Date.parse('2026-01-21T18:00:00Z');
describe('whole-search NBA credit preflight', () => {
  it('plans all 26 markets for one game at 52 without truncation', () => {
    const plan = planNBAResearch([event], NBA_VERIFIED_RESEARCH_MARKETS, new Map(), 70, now);
    expect(plan).toMatchObject({ expectedCredits: 52, reservedPlanCredits: 52, completeWithinBudget: true });
    expect(plan.games[0].refreshMarkets).toHaveLength(26);
  });
  it('reports the second full uncached game as blocked under the single 70-credit allowance', () => {
    const plan = planNBAResearch([event, { ...event, id: 'fedcba9876543210fedcba9876543210' }], NBA_VERIFIED_RESEARCH_MARKETS, new Map(), 70, now);
    expect(plan).toMatchObject({ expectedCredits: 104, reservedPlanCredits: 52, completeWithinBudget: false });
    expect(plan.games.map(game => game.status)).toEqual(['REFRESH_PLANNED', 'BUDGET_BLOCKED']);
    expect(plan.games[1].refreshMarkets).toHaveLength(26);
  });
  it('can cover multiple games when the selected contract scope fits, including exactly 70', () => {
    const events = Array.from({ length: 7 }, (_, index) => ({ ...event, id: String(index).padStart(32, '0') }));
    const plan = planNBAResearch(events, NBA_VERIFIED_RESEARCH_MARKETS.slice(0, 5), new Map(), 70, now);
    expect(plan).toMatchObject({ expectedCredits: 70, reservedPlanCredits: 70, completeWithinBudget: true });
    expect(planNBAResearch([...events, { ...event, id: '8'.repeat(32) }], NBA_VERIFIED_RESEARCH_MARKETS.slice(0, 5), new Map(), 70, now).games.at(-1)?.status).toBe('BUDGET_BLOCKED');
  });
  it('plans zero quote purchases for multiple fully cached games', () => {
    const markets = NBA_VERIFIED_RESEARCH_MARKETS.slice(0, 3);
    const events = [event, { ...event, id: 'f'.repeat(32) }];
    const receipts = new Map(events.map(entry => [entry.id, { observedAt: new Date(now).toISOString(), regions: ['us', 'us2'] as ['us', 'us2'],
      requestedMarkets: markets, data: { id: entry.id, sport_key: 'basketball_nba', commence_time: entry.commenceTime,
        home_team: entry.homeTeam, away_team: entry.awayTeam, bookmakers: [{ key: 'book', title: 'Book', markets: markets.map(key => ({
          key, last_update: new Date(now).toISOString(), outcomes: [{ name: key === 'h2h' || key === 'spreads' ? 'Home' : 'Over', price: -110, point: 1.5 }],
        })) }] } }]));
    const plan = planNBAResearch(events, markets, receipts, 0, now);
    expect(plan.expectedCredits).toBe(0);
    expect(plan.games.every(game => game.status === 'CACHE_READY')).toBe(true);
  });
});