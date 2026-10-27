import { describe, expect, it } from 'vitest';
import { DEFAULT_NBA_RESEARCH_FILTER, NBA_MARKET_CATEGORIES, NBA_RESEARCH_MARKETS, matchesNBAResearchFilter, normalizeNBAResearchFilter } from './researchMarkets';

describe('NBA research market selection', () => {
  it('retains all 41 requested and existing entries in five categories with unique identities', () => {
    expect(NBA_RESEARCH_MARKETS).toHaveLength(41);
    expect(new Set(NBA_RESEARCH_MARKETS.map(entry => entry.id)).size).toBe(41);
    expect(NBA_MARKET_CATEGORIES).toHaveLength(5);
  });
  it('defaults to all markets without turning Clear All into unrestricted research', () => {
    expect(normalizeNBAResearchFilter(undefined).marketIds).toBeNull();
    expect(matchesNBAResearchFilter(DEFAULT_NBA_RESEARCH_FILTER, 'assists', 'under')).toBe(true);
    expect(matchesNBAResearchFilter({ ...DEFAULT_NBA_RESEARCH_FILTER, marketIds: [] }, 'assists', 'under')).toBe(false);
  });
  it('unions exact market identities and supports either or both sides', () => {
    const filter = normalizeNBAResearchFilter({ marketIds: ['player_points', 'player_assists'], sides: ['under'] });
    expect(matchesNBAResearchFilter(filter, 'points', 'under')).toBe(true);
    expect(matchesNBAResearchFilter(filter, 'assists', 'under')).toBe(true);
    expect(matchesNBAResearchFilter(filter, 'pra', 'under')).toBe(false);
    expect(matchesNBAResearchFilter(filter, 'points', 'over')).toBe(false);
  });
  it('never substitutes a full-game or regular market for unsupported selections', () => {
    for (const entry of NBA_RESEARCH_MARKETS.filter(entry => entry.connection === 'Not connected')) {
      const filter = normalizeNBAResearchFilter({ marketIds: [entry.id] });
      expect(matchesNBAResearchFilter(filter, 'points', 'over')).toBe(false);
      expect(matchesNBAResearchFilter(filter, 'TOTAL', 'OVER')).toBe(false);
    }
  });
  it('preserves home/away selections when side restrictions apply only to totals/props', () => {
    const filter = normalizeNBAResearchFilter({ marketIds: ['h2h', 'totals'], sides: ['under'] });
    expect(matchesNBAResearchFilter(filter, 'MONEYLINE', 'HOME')).toBe(true);
    expect(matchesNBAResearchFilter(filter, 'TOTAL', 'UNDER')).toBe(true);
    expect(matchesNBAResearchFilter(filter, 'TOTAL', 'OVER')).toBe(false);
  });
  it('rejects unknown market IDs without broadening the selection', () => {
    expect(normalizeNBAResearchFilter({ marketIds: ['fake'] }).marketIds).toEqual([]);
  });
  it('matches provider presentation identities without admitting period or alternate substitutions', () => {
    const filter = normalizeNBAResearchFilter({ marketIds: ['player_points'] });
    expect(matchesNBAResearchFilter(filter, 'player_points', 'over')).toBe(true);
    expect(matchesNBAResearchFilter(filter, 'player_points_q1', 'over')).toBe(false);
    expect(matchesNBAResearchFilter(filter, 'player_points_alternate', 'over')).toBe(false);
  });
});