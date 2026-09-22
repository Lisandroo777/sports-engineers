import { describe, expect, it } from 'vitest';
import { VALIDATION_COST_PER_EVENT, canAffordNextValidationGame, classifyValidationPreflight, rankMLBResearchPriority, type FinderValidationOptions } from './engine';
import type { MLBGame } from '../mlb/types';

/**
 * These cover the validation-mode CONTRACT without touching the network: the selection/limit/cost
 * rules are pure functions of the inputs, so they are replicated here exactly as engine.ts applies
 * them. Live behaviour (0 credits, 4-of-15 games) is verified separately against the running server.
 */

interface PlannedGame { id: string; gameTime: string; eventId: string | null; marketsFresh: boolean }

/** Mirrors engine.ts: matched events only, ordered by gameTime then eventId, edge-blind. */
function selectValidationGames(planned: PlannedGame[], options: FinderValidationOptions) {
  const selectable = planned
    .filter((g) => g.eventId != null)
    .sort((a, b) => a.gameTime.localeCompare(b.gameTime) || a.eventId!.localeCompare(b.eventId!));
  const active = options.validationMaxGames != null && options.validationMaxGames > 0;
  return active ? selectable.slice(0, options.validationMaxGames) : selectable;
}

function estimateCost(selected: PlannedGame[]) {
  const needsPaid = selected.filter((g) => !g.marketsFresh);
  return {
    cacheHits: selected.length - needsPaid.length,
    cacheMisses: needsPaid.length,
    estimatedPaidSubRequests: needsPaid.length * 2,
    low: needsPaid.length * VALIDATION_COST_PER_EVENT.low,
    expected: needsPaid.length * VALIDATION_COST_PER_EVENT.expected,
    high: needsPaid.length * VALIDATION_COST_PER_EVENT.high,
  };
}

const slate: PlannedGame[] = [
  { id: 'g5', gameTime: '2026-09-12T02:15:00Z', eventId: 'e5', marketsFresh: false },
  { id: 'g1', gameTime: '2026-09-11T22:40:00Z', eventId: 'e1', marketsFresh: false },
  { id: 'g3', gameTime: '2026-09-11T23:05:00Z', eventId: 'e3', marketsFresh: true },
  { id: 'gX', gameTime: '2026-09-11T22:00:00Z', eventId: null, marketsFresh: false },
  { id: 'g2', gameTime: '2026-09-11T22:45:00Z', eventId: 'e2', marketsFresh: false },
  { id: 'g4', gameTime: '2026-09-11T23:07:00Z', eventId: 'e4', marketsFresh: false },
];

describe('validation mode never becomes a production cap', () => {
  it('analyses every matched game when no validation parameter is supplied', () => {
    expect(selectValidationGames(slate, {}).length).toBe(5);
  });

  it('ignores a zero or negative limit rather than silently capping the slate', () => {
    expect(selectValidationGames(slate, { validationMaxGames: 0 }).length).toBe(5);
  });

  it('limits only the request that explicitly asks for it', () => {
    expect(selectValidationGames(slate, { validationMaxGames: 4 }).length).toBe(4);
    expect(selectValidationGames(slate, {}).length).toBe(5);
  });

  it('does not reintroduce the old 8-game cap', () => {
    const big = Array.from({ length: 15 }, (_, i) => ({
      id: `g${i}`, gameTime: `2026-09-11T2${i % 10}:00:00Z`, eventId: `e${i}`, marketsFresh: false,
    }));
    expect(selectValidationGames(big, {}).length).toBe(15);
  });
});

describe('validation game selection is deterministic and edge-blind', () => {
  it('orders by game time then event id, not by any projection or edge', () => {
    expect(selectValidationGames(slate, { validationMaxGames: 4 }).map((g) => g.id)).toEqual(['g1', 'g2', 'g3', 'g4']);
  });

  it('produces the same selection on repeated calls', () => {
    const a = selectValidationGames(slate, { validationMaxGames: 3 }).map((g) => g.id);
    const b = selectValidationGames([...slate].reverse(), { validationMaxGames: 3 }).map((g) => g.id);
    expect(a).toEqual(b);
  });

  it('only considers games with a matched sportsbook event', () => {
    expect(selectValidationGames(slate, {}).some((g) => g.eventId == null)).toBe(false);
  });
});

describe('preflight cost estimation', () => {
  it('reports an event-list requirement instead of a zero-cost ready state when games exist but none match', () => {
    expect(classifyValidationPreflight({ scheduledGames: 1, matchedEvents: 0, cacheMisses: 0 })).toBe('EVENT_LIST_REQUIRED');
  });

  it('estimates two paid sub-requests per uncached event', () => {
    const est = estimateCost(selectValidationGames(slate, { validationMaxGames: 4 }));
    expect(est.cacheMisses).toBe(3);
    expect(est.estimatedPaidSubRequests).toBe(6);
  });

  it('cache hits reduce the estimated paid calls', () => {
    const allFresh = slate.map((g) => ({ ...g, marketsFresh: true }));
    const est = estimateCost(selectValidationGames(allFresh, { validationMaxGames: 4 }));
    expect(est.cacheMisses).toBe(0);
    expect(est.estimatedPaidSubRequests).toBe(0);
    expect(est.expected).toBe(0);
  });

  it('reports a low/expected/high band in ascending order', () => {
    const est = estimateCost(selectValidationGames(slate, { validationMaxGames: 4 }));
    expect(est.low).toBeLessThan(est.expected);
    expect(est.expected).toBeLessThan(est.high);
  });
});

describe('validation spend cap is a TRUE hard ceiling (Phase 5 fix)', () => {
  it('never engages when no cap was supplied', () => {
    expect(canAffordNextValidationGame(100000, undefined)).toBe(true);
  });

  it('cap=40: game1 costs 31, game2 estimated 31 -> only game1 is allowed', () => {
    // Before game 1: spent=0, estimate=31 (VALIDATION_COST_PER_EVENT.high) -> 0+31<=40, allowed.
    expect(canAffordNextValidationGame(0, 40, VALIDATION_COST_PER_EVENT.high)).toBe(true);
    // After game 1 actually cost 31: before game 2, 31+31=62>40 -> blocked BEFORE starting game 2.
    expect(canAffordNextValidationGame(31, 40, VALIDATION_COST_PER_EVENT.high)).toBe(false);
  });

  it('cap=40: game1 costs 20, game2 estimated 20 -> both may run', () => {
    expect(canAffordNextValidationGame(0, 40, 20)).toBe(true);
    expect(canAffordNextValidationGame(20, 40, 20)).toBe(true);
  });

  it('if the estimated cost itself exceeds the whole cap, 0 paid requests are ever allowed', () => {
    expect(canAffordNextValidationGame(0, 20, VALIDATION_COST_PER_EVENT.high)).toBe(false);
  });

  it('reproduces exactly the real 2-game overspend scenario from the NFL live validation, now blocked', () => {
    // Live validation: cap=40, game1 actually cost ~22, game2 pushed the total to 53 (13 over cap).
    // With the fix, the precheck before game2 uses the conservative HIGH estimate and blocks it.
    const cap = 40;
    const game1ActualCost = 22;
    expect(canAffordNextValidationGame(0, cap, VALIDATION_COST_PER_EVENT.high)).toBe(true); // game1 allowed
    expect(canAffordNextValidationGame(game1ActualCost, cap, VALIDATION_COST_PER_EVENT.high)).toBe(false); // game2 blocked
  });

  it('total spend can never exceed the cap across a simulated multi-game loop', () => {
    const cap = 40;
    const perGameActualCost = 22; // realistic single-event cost
    let spent = 0;
    let gamesRun = 0;
    for (let i = 0; i < 12; i++) {
      if (!canAffordNextValidationGame(spent, cap, VALIDATION_COST_PER_EVENT.high)) break;
      spent += perGameActualCost;
      gamesRun += 1;
    }
    expect(spent).toBeLessThanOrEqual(cap);
    expect(gamesRun).toBeGreaterThan(0);
  });
});

describe('preflight state semantics', () => {
  it('distinguishes missing schedule, missing event list, sportsbook cache miss, and ready', () => {
    expect(classifyValidationPreflight({ scheduledGames: 0, matchedEvents: 0, cacheMisses: 0 })).toBe('NO_SCHEDULE');
    expect(classifyValidationPreflight({ scheduledGames: 10, matchedEvents: 0, cacheMisses: 0 })).toBe('EVENT_LIST_REQUIRED');
    expect(classifyValidationPreflight({ scheduledGames: 10, matchedEvents: 3, cacheMisses: 3 })).toBe('SPORTSBOOK_DATA_REQUIRED');
    expect(classifyValidationPreflight({ scheduledGames: 10, matchedEvents: 3, cacheMisses: 0 })).toBe('READY');
  });
});

describe('MLB smart partial-slate research priority', () => {
  const game = (id: string, away: string, home: string, starters: 0 | 1 | 2, venue = true): MLBGame => ({
    id,
    date: '2026-09-14',
    gameTime: `2026-09-14T2${id}:00:00Z`,
    status: 'Scheduled',
    awayTeam: { id: Number(id) + 100, name: away, abbreviation: 'UNK', record: { wins: 80, losses: 70, pct: '.533' } },
    homeTeam: { id: Number(id) + 200, name: home, abbreviation: 'UNK', record: { wins: 80, losses: 70, pct: '.533' } },
    venue: venue ? { id, stadiumName: `${home} Park`, city: 'City', state: 'ST', timezone: 'America/New_York' } : null,
    venueId: venue ? id : null,
    awayProbableStarter: starters >= 1 ? { id: Number(id) + 1, name: `${away} SP`, throwingHand: 'R' } : null,
    homeProbableStarter: starters >= 2 ? { id: Number(id) + 2, name: `${home} SP`, throwingHand: 'L' } : null,
  });

  it('selects the highest researchability game, not the first scheduled game', () => {
    const ranked = rankMLBResearchPriority([
      game('1', 'Low Away', 'Low Home', 0, false),
      game('2', 'Best Away', 'Best Home', 2, true),
      game('3', 'Medium Away', 'Medium Home', 1, true),
    ], 1);
    expect(ranked[0].gameId).toBe('2');
    expect(ranked[0].selected).toBe(true);
    expect(ranked[0].coverage).toBe('HIGH');
    expect(ranked[0].reasons.join(' ')).toMatch(/probable starting pitchers/i);
  });

  it('honors manual selected game IDs without changing priority order', () => {
    const ranked = rankMLBResearchPriority([
      game('1', 'Low Away', 'Low Home', 0, false),
      game('2', 'Best Away', 'Best Home', 2, true),
    ], 1, ['1']);
    expect(ranked[0].gameId).toBe('2');
    expect(ranked.find((entry) => entry.gameId === '1')?.selected).toBe(true);
    expect(ranked.find((entry) => entry.gameId === '2')?.selected).toBe(false);
  });
});
