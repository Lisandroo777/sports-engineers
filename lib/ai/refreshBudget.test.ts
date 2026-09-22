import { describe, expect, it } from 'vitest';
import { canAuthorizeFullSlate, safelyResearchableGames } from './refreshBudget';

describe('AI Finder refresh budget safety', () => {
  it('disables a full-slate authorization when maximum cost exceeds available credits', () => {
    expect(canAuthorizeFullSlate(403, 137)).toBe(false);
    expect(canAuthorizeFullSlate(120, 137)).toBe(true);
    expect(canAuthorizeFullSlate(null, 137)).toBe(false);
  });

  it('calculates safe partial coverage using the conservative 31-credit game estimate', () => {
    expect(safelyResearchableGames(30, 13)).toBe(0);
    expect(safelyResearchableGames(60, 13)).toBe(1);
    expect(safelyResearchableGames(90, 13)).toBe(2);
    expect(safelyResearchableGames(403, 13)).toBe(13);
  });
});
