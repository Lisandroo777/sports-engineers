import { describe, expect, it } from 'vitest';
import { projectNBAMarket, estimateExpectedMinutes, NBA_MIN_SAMPLE } from './projection';
import type { NBAGameLogEntry } from './types';

/** Builds a completed-game log. `min` omitted = minutes genuinely missing (NOT zero minutes). */
function game(i: number, stats: Partial<Record<string, number>>, min?: number): NBAGameLogEntry {
  return {
    gameId: `g${i}`, date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    opponent: 'Opp', opponentAbbreviation: 'OPP', homeAway: 'home', result: 'W',
    stats: { ...(min != null ? { minutes: min } : {}), ...stats } as Record<string, number>,
  };
}

/** n games at a steady role: `min` minutes and `pts`/`reb`/`ast` production. */
function steady(n: number, min: number, pts: number, reb = 5, ast = 4): NBAGameLogEntry[] {
  return Array.from({ length: n }, (_, i) => game(i, { points: pts, totalRebounds: reb, assists: ast }, min));
}

describe('NBA expected minutes', () => {
  it('is stable for a consistent 34-minute player', () => {
    const m = estimateExpectedMinutes(steady(20, 34, 20));
    expect(m.expectedMinutes).toBeCloseTo(34, 1);
    expect(m.minutesReliability).not.toBe('UNRELIABLE');
    expect(m.reasons).not.toContain('ROLE_DECREASE');
  });

  it('detects a 34 -> 18 minute role DECREASE', () => {
    const logs = [...steady(15, 34, 20), ...steady(5, 18, 10)];
    const m = estimateExpectedMinutes(logs);
    expect(m.reasons).toContain('ROLE_DECREASE');
    // Weighted toward the recent role, not anchored to the stale 34-minute baseline.
    expect(m.expectedMinutes!).toBeLessThan(30);
    expect(m.minutesReliability).toBe('LOW');
  });

  it('detects an 18 -> 32 minute role INCREASE', () => {
    const logs = [...steady(15, 18, 8), ...steady(5, 32, 18)];
    const m = estimateExpectedMinutes(logs);
    expect(m.reasons).toContain('ROLE_INCREASE');
    expect(m.expectedMinutes!).toBeGreaterThan(20);
  });

  it('flags high minutes volatility', () => {
    const logs = Array.from({ length: 14 }, (_, i) => game(i, { points: 10 }, i % 2 === 0 ? 6 : 36));
    expect(estimateExpectedMinutes(logs).reasons).toContain('HIGH_MINUTES_VOLATILITY');
  });

  it('never treats a game with missing minutes as a zero-minute game', () => {
    const withMissing = [...steady(10, 30, 15), game(11, { points: 15 })];
    const m = estimateExpectedMinutes(withMissing);
    expect(m.gamesWithMinutes).toBe(10);
    expect(m.expectedMinutes).toBeCloseTo(30, 1);
  });

  it('fails closed below the minimum minutes sample', () => {
    const m = estimateExpectedMinutes(steady(NBA_MIN_SAMPLE - 1, 30, 15));
    expect(m.expectedMinutes).toBeNull();
    expect(m.minutesReliability).toBe('UNRELIABLE');
    expect(m.reasons).toContain('INSUFFICIENT_MINUTES_SAMPLE');
  });

  it('does not claim an injury cause without injury evidence (known-active status)', () => {
    const logs = [...steady(15, 34, 20), ...steady(5, 18, 10)];
    // Injury status is explicitly known here, so no INJURY_STATUS_UNKNOWN reason is expected —
    // the role change is reported only as ROLE_DECREASE, never invented as an injury cause.
    const reasons = estimateExpectedMinutes(logs, 'ACTIVE').reasons.join(',');
    expect(reasons).not.toMatch(/RETURN_FROM_INJURY|INJURY/i);
  });

  it('flags INJURY_STATUS_UNKNOWN when injury tier is not provided', () => {
    const logs = [...steady(15, 34, 20), ...steady(5, 18, 10)];
    const reasons = estimateExpectedMinutes(logs).reasons;
    expect(reasons).toContain('INJURY_STATUS_UNKNOWN');
  });
});

describe('NBA projection = rate x minutes, not a stat average', () => {
  it('projects a steady player near their historical output', () => {
    const p = projectNBAMarket({ logs: steady(20, 34, 20), market: 'points' });
    expect(p.status).toBe('OK');
    expect(p.projection).toBeCloseTo(20, 0);
    expect(p.method).toBe('nba_rate_x_minutes');
  });

  it('a role decrease lowers the projection well below the raw stat average', () => {
    // 15 games at 34min/24pts then 5 at 18min/12pts. Raw mean would be ~21.
    const logs = [...steady(15, 34, 24), ...steady(5, 18, 12)];
    const p = projectNBAMarket({ logs, market: 'points' });
    const rawMean = (15 * 24 + 5 * 12) / 20;
    expect(p.projection!).toBeLessThan(rawMean);
    expect(p.reliabilityReasons).toContain('ROLE_DECREASE');
    expect(p.reliability).toBe('LOW');
  });

  it('a role increase raises the projection above the raw stat average', () => {
    const logs = [...steady(15, 18, 9), ...steady(5, 32, 18)];
    const p = projectNBAMarket({ logs, market: 'points' });
    const rawMean = (15 * 9 + 5 * 18) / 20;
    expect(p.projection!).toBeGreaterThan(rawMean);
    expect(p.reliabilityReasons).toContain('ROLE_INCREASE');
  });

  it('exposes the rate and minutes it used', () => {
    const p = projectNBAMarket({ logs: steady(20, 30, 15), market: 'points' });
    expect(p.inputs.ratePerMinute).toBeCloseTo(0.5, 2);
    expect(p.inputs.expectedMinutes).toBeCloseTo(30, 1);
  });

  it('fails closed on a small sample', () => {
    const p = projectNBAMarket({ logs: steady(NBA_MIN_SAMPLE - 1, 30, 15), market: 'points' });
    expect(p.status).toBe('UNAVAILABLE');
    expect(p.projection).toBeNull();
    expect(p.reliability).toBe('UNRELIABLE');
  });

  it('fails closed when the stat is missing entirely', () => {
    const logs = Array.from({ length: 12 }, (_, i) => game(i, { totalRebounds: 5 }, 30));
    const p = projectNBAMarket({ logs, market: 'points' });
    expect(p.status).toBe('UNAVAILABLE');
    expect(p.reliabilityReasons).toContain('MISSING_STAT');
  });

  it('never returns 0 in place of a missing projection', () => {
    const p = projectNBAMarket({ logs: [], market: 'points' });
    expect(p.projection).toBeNull();
    expect(p.projection).not.toBe(0);
  });
});

describe('NBA projection uncertainty', () => {
  it('is not a constant — it reflects the underlying volatility', () => {
    const calm = projectNBAMarket({ logs: steady(20, 30, 15), market: 'points' });
    const volatile = projectNBAMarket({
      logs: Array.from({ length: 20 }, (_, i) => game(i, { points: i % 2 === 0 ? 4 : 30 }, i % 2 === 0 ? 14 : 36)),
      market: 'points',
    });
    expect(volatile.uncertainty!).toBeGreaterThan(calm.uncertainty ?? 0);
  });

  it('combines rate and minutes uncertainty rather than ignoring minutes', () => {
    const p = projectNBAMarket({
      logs: Array.from({ length: 20 }, (_, i) => game(i, { points: 18 }, 24 + (i % 5) * 4)),
      market: 'points',
    });
    expect(p.uncertainty).not.toBeNull();
    expect(p.uncertainty!).toBeGreaterThan(0);
  });
});

describe('NBA derived markets', () => {
  it('projects PRA as the sum of its components', () => {
    const logs = steady(20, 32, 20, 8, 5);
    const pra = projectNBAMarket({ logs, market: 'pra' });
    const parts = (['points', 'rebounds', 'assists'] as const).map((m) => projectNBAMarket({ logs, market: m }).projection!);
    expect(pra.projection).toBeCloseTo(parts.reduce((s, v) => s + v, 0), 1);
    expect(pra.method).toBe('nba_derived_sum');
  });

  it('uses real same-game totals for uncertainty, not a naive sum of component sds', () => {
    const logs = Array.from({ length: 20 }, (_, i) => game(i, {
      // Components move in opposite directions, so the true total is far steadier than the parts.
      points: i % 2 === 0 ? 26 : 14, totalRebounds: i % 2 === 0 ? 4 : 16, assists: 5,
    }, 32));
    const pra = projectNBAMarket({ logs, market: 'pra' });
    const naiveSum = (['points', 'rebounds', 'assists'] as const)
      .reduce((s, m) => s + (projectNBAMarket({ logs, market: m }).uncertainty ?? 0), 0);
    expect(pra.uncertainty!).toBeLessThan(naiveSum);
  });

  it('fails closed when a component is missing', () => {
    const logs = Array.from({ length: 12 }, (_, i) => game(i, { points: 20, totalRebounds: 5 }, 30));
    const pra = projectNBAMarket({ logs, market: 'pra' });
    expect(pra.status).toBe('UNAVAILABLE');
    expect(pra.reliabilityReasons).toContain('MISSING_COMPONENT');
  });
});

describe('NBA projection reliability gating', () => {
  it('an UNRELIABLE projection is never OK with a number attached', () => {
    const p = projectNBAMarket({ logs: steady(2, 30, 15), market: 'points' });
    expect(p.reliability).toBe('UNRELIABLE');
    expect(p.projection).toBeNull();
  });

  it('grades a clean large sample above a role-changed one', () => {
    const clean = projectNBAMarket({ logs: steady(25, 32, 18), market: 'points' });
    const changed = projectNBAMarket({ logs: [...steady(18, 34, 20), ...steady(6, 16, 8)], market: 'points' });
    expect(['HIGH', 'MEDIUM']).toContain(clean.reliability);
    expect(changed.reliability).toBe('LOW');
  });
});
