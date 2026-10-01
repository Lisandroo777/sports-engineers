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

  it('uses the sport-specific per-game cost so an NFL budget never promises unaffordable games', () => {
    // NFL costs ~61 credits per uncached game, so a 90-credit cap covers exactly one.
    expect(safelyResearchableGames(90, 14, 61)).toBe(1);
    expect(safelyResearchableGames(60, 14, 61)).toBe(0);
    expect(safelyResearchableGames(854, 14, 61)).toBe(14);
  });

  it('counts already-cached games as free so a small budget still researches them', () => {
    expect(safelyResearchableGames(0, 14, 61, 3)).toBe(3);
    expect(safelyResearchableGames(90, 14, 61, 3)).toBe(4);
    expect(safelyResearchableGames(90, 2, 61, 3)).toBe(2);
  });
});
