import { describe, expect, it } from 'vitest';
import { historicalFixture, quote, binding } from './fixtures';
import { projectNBAGame } from './model';
import { buildGameRecommendation, classifyGameRecommendation } from './recommendations';

const time = new Date('2026-01-21T18:00:00Z');
describe('GAME recommendations under unchanged publication tiers', () => {
  it('represents moneylines with nullable line and no athlete identity, and fails incomplete evidence closed', () => {
    const record = buildGameRecommendation(projectNBAGame(historicalFixture()), quote({ market: 'MONEYLINE', selection: 'HOME', team: 'HOME', line: null }),
      binding, { injuriesVerified: false, startingLineupsVerified: false, conflictsResolved: false }, time);
    expect(record.recommendationType).toBe('GAME');
    expect(record.line).toBeNull();
    expect(record).not.toHaveProperty('playerId');
    expect(record.pickTier).toBe('PASS');
  });
  it('requires genuine readiness and positive current EV, never grants Elite/NUKE to the unvalidated foundation', () => {
    const record = buildGameRecommendation(projectNBAGame(historicalFixture()), quote({ market: 'MONEYLINE', selection: 'HOME', team: 'HOME', line: null }),
      binding, { injuriesVerified: true, startingLineupsVerified: true, conflictsResolved: true }, time);
    expect(record.pickTier).toBe('EDGE');
    expect(record.tierScore).toBe(75);
    expect(classifyGameRecommendation(record, new Date('2026-01-21T20:00:00Z')).pickTier).toBe('PASS');
    const negative = buildGameRecommendation(projectNBAGame(historicalFixture()), quote({ market: 'MONEYLINE', selection: 'AWAY', team: 'AWAY', line: null }),
      binding, { injuriesVerified: true, startingLineupsVerified: true, conflictsResolved: true }, time);
    expect(negative.pickTier).toBe('PASS');
  });
});