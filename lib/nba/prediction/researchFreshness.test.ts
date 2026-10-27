import { describe, expect, it } from 'vitest';
import { mergeNBAResearchReceipts, nbaResearchMarketCoverage, type NBAResearchReceipt } from './researchReceipt';

const now = Date.parse('2026-01-21T18:00:00Z');
const expected = { id: '0123456789abcdef0123456789abcdef', tipoff: '2026-01-21T23:00:00Z', homeTeam: 'Home', awayTeam: 'Away' };
function receipt(markets: string[], stamp = '2026-01-21T17:59:30Z'): NBAResearchReceipt {
  return { observedAt: stamp, requestedMarkets: markets, regions: ['us', 'us2'], data: { id: expected.id, sport_key: 'basketball_nba',
    commence_time: expected.tipoff, home_team: 'Home', away_team: 'Away', bookmakers: [{ key: 'book', title: 'Book', markets: markets.map(key => ({ key,
      last_update: stamp, outcomes: [{ name: 'Over', description: 'Player', point: 1.5, price: -110 }] })) }] } };
}
describe('individual NBA market receipt freshness', () => {
  it('does not let one fresh market hide a missing or stale selected sibling', () => {
    const mixed = receipt(['player_points', 'player_rebounds']);
    mixed.data.bookmakers![0].markets![1].last_update = '2026-01-21T17:50:00Z';
    expect(nbaResearchMarketCoverage(mixed, expected, ['player_points', 'player_rebounds', 'player_assists'], now).map(market => market.state))
      .toEqual(['FRESH', 'STALE', 'MISSING']);
  });
  it('merges disjoint refreshes while retaining original market observations', () => {
    const old = receipt(['player_points'], '2026-01-21T17:50:00Z');
    const merged = mergeNBAResearchReceipts(old, receipt(['player_assists']));
    expect(merged.requestedMarkets).toEqual(['player_points', 'player_assists']);
    expect(merged.marketObservedAt?.player_points).toBe(old.observedAt);
    expect(nbaResearchMarketCoverage(merged, expected, merged.requestedMarkets, now).map(market => market.state)).toEqual(['STALE', 'FRESH']);
  });
  it('records confirmed not-posted results briefly, then makes them refreshable', () => {
    const absent = receipt(['player_points']); absent.data.bookmakers = [];
    expect(nbaResearchMarketCoverage(absent, expected, ['player_points'], now)[0].state).toBe('NOT_POSTED');
    expect(nbaResearchMarketCoverage(absent, expected, ['player_points'], now + 61000)[0].needsRefresh).toBe(true);
    const merged = mergeNBAResearchReceipts(receipt(['player_points']), absent);
    expect(merged.data.bookmakers?.flatMap(book => book.markets ?? [])).toEqual([]);
  });
  it('cannot reuse a receipt under another event or team', () => {
    expect(nbaResearchMarketCoverage(receipt(['player_points']), { ...expected, homeTeam: 'Other' }, ['player_points'], now)[0].state).toBe('MISSING');
  });
});