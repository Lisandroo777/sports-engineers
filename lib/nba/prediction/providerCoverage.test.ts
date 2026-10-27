import { describe, expect, it } from 'vitest';
import { auditNBAProviderCoverage, NBA_DOCUMENTED_QUOTE_MARKETS, type NBAProviderCoverageReceipt } from './providerCoverage';

const now = Date.parse('2026-01-21T18:00:00Z');
const receipt: NBAProviderCoverageReceipt = { observedAt: '2026-01-21T17:59:00Z', expectedEventId: '0123456789abcdef0123456789abcdef',
  expectedTipoff: '2026-01-21T23:00:00Z', data: { id: '0123456789abcdef0123456789abcdef', sport_key: 'basketball_nba',
    commence_time: '2026-01-21T23:00:00Z', bookmakers: [{ key: 'fixture', markets: [
      { key: 'player_field_goals', last_update: '2026-01-21T17:58:00Z', outcomes: [{ name: 'Over', description: 'Fixture', point: 8.5, price: -110 }] },
      { key: 'player_threes', last_update: '2026-01-21T17:58:00Z' },
      { key: 'player_double_double', last_update: '2026-01-21T17:58:00Z', outcomes: [{ name: 'Yes', description: 'Fixture', price: 140 }] },
    ] }] } };

describe('offline NBA provider coverage audit', () => {
  it('audits all 41 without pretending documentation verifies current prices', () => {
    expect(NBA_DOCUMENTED_QUOTE_MARKETS).toHaveLength(31);
    const result = auditNBAProviderCoverage([], now);
    expect(result).toHaveLength(41);
    expect(result.every(entry => entry.status === 'NOT_OBSERVED')).toBe(true);
    expect(result.filter(entry => !entry.documented)).toHaveLength(10);
  });
  it('distinguishes advertised keys from valid priced outcomes and preserves binary contracts', () => {
    const result = auditNBAProviderCoverage([receipt], now);
    expect(result.find(entry => entry.id === 'player_field_goals')).toMatchObject({ quoteCount: 1, status: 'CURRENT_QUOTES_OBSERVED' });
    expect(result.find(entry => entry.id === 'player_threes')).toMatchObject({ quoteCount: 0, status: 'ADVERTISED_NO_CURRENT_QUOTES' });
    expect(result.find(entry => entry.id === 'player_double_double')).toMatchObject({ quoteCount: 1 });
  });
  it('rejects stale receipts, identity mismatches, future observations and started games', () => {
    for (const changed of [{ ...receipt, observedAt: '2026-01-21T16:00:00Z' },
      { ...receipt, observedAt: '2026-01-21T19:00:00Z' }, { ...receipt, expectedEventId: 'bad' },
      { ...receipt, expectedTipoff: '2026-01-21T18:00:00Z' }]) {
      expect(auditNBAProviderCoverage([changed], now).every(entry => entry.quoteCount === 0)).toBe(true);
    }
  });
});