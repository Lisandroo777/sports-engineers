import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OddsEvent } from '../../../odds/types';
import type { NBAContextSnapshot } from '../../context/types';
import type { NBAGame } from '../../types';
import { binding, historicalFixture, quote } from './fixtures';
import { researchNBAGameLines } from './pipeline';
import type { loadCachedNBAGameQuotes } from './quotes';
import type { GameQuote } from './types';

const predictionAt = '2026-01-21T18:00:00Z';

function game(overrides: Partial<NBAGame> = {}): NBAGame {
  return { id: 'target', gameTime: '2026-01-21T23:00:00Z', completed: false, homeScore: null, awayScore: null,
    homeTeam: { id: 1, name: 'Home', displayName: 'Home', abbreviation: 'HOM', logoUrl: null },
    awayTeam: { id: 2, name: 'Away', displayName: 'Away', abbreviation: 'AWY', logoUrl: null }, ...overrides };
}

function event(overrides: Partial<OddsEvent> = {}): OddsEvent {
  return { id: 'odds-1', commenceTime: '2026-01-21T23:00:00Z', homeTeam: 'Home', awayTeam: 'Away', ...overrides };
}

function dependencies(quotes: GameQuote[] = [], snapshot: NBAContextSnapshot = historicalFixture().snapshot) {
  return {
    loadSnapshot: vi.fn<(gameId: string, teamId: number) => Promise<NBAContextSnapshot>>(async () => snapshot),
    loadQuotes: vi.fn<typeof loadCachedNBAGameQuotes>(async () => quotes.length
      ? { status: 'AVAILABLE' as const, quotes, reason: null }
      : { status: 'UNSUPPORTED_QUOTE' as const, quotes, reason: 'No existing cached quotes' }),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(predictionAt));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden by fixture'); }));
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('NBA game-line pipeline with injected research and quote loaders', () => {
  it('binds a sportsbook event listed at actual tipoff minutes after the schedule, but not a different start', async () => {
    const shifted = '2026-01-21T23:10:00Z';
    const near = dependencies([quote({ commenceTime: shifted })]);
    const bound = await researchNBAGameLines([game()], [event({ commenceTime: shifted })], near);
    expect(bound.modeledGames[0].status).toBe('QUOTE_AVAILABLE');
    expect(near.loadQuotes).toHaveBeenCalled();
    const far = dependencies([quote({ commenceTime: '2026-01-21T23:30:00Z' })]);
    const unbound = await researchNBAGameLines([game()], [event({ commenceTime: '2026-01-21T23:30:00Z' })], far);
    expect(unbound.modeledGames[0].status).toBe('MODELED_NOT_BETTABLE');
    expect(far.loadQuotes).not.toHaveBeenCalled();
  });

  it('returns modeled, not bettable research without a matching odds event or invented price', async () => {
    const loaders = dependencies();

    const result = await researchNBAGameLines([game()], [], loaders);

    expect(result.recommendations).toEqual([]);
    expect(result.modeledGames).toHaveLength(1);
    expect(result.modeledGames[0]).toMatchObject({ recommendationType: 'GAME', gameId: 'target',
      status: 'MODELED_NOT_BETTABLE', projection: { status: 'AVAILABLE', predictionAt, validationStatus: 'UNVALIDATED' } });
    expect(result.modeledGames[0].projection?.means?.total).toEqual(expect.any(Number));
    expect(result.modeledGames[0].reason).toMatch(/No line, odds or EV invented/);
    for (const field of ['line', 'odds', 'quote', 'americanOdds', 'trueProbability', 'evPercent']) {
      expect(result.modeledGames[0]).not.toHaveProperty(field);
      expect(result.modeledGames[0].projection).not.toHaveProperty(field);
    }
    expect(result.modeledGames[0].projection).not.toHaveProperty('scenarios');
    expect(loaders.loadSnapshot.mock.calls).toEqual([['target', 1]]);
    expect(loaders.loadQuotes).not.toHaveBeenCalled();
  });

  it('checks existing NBA game quote keys with exact event binding and keeps missing prices absent', async () => {
    const loaders = dependencies();

    const result = await researchNBAGameLines([game()], [event()], loaders);

    expect(result.recommendations).toEqual([]);
    expect(result.modeledGames[0]).toMatchObject({ status: 'MODELED_NOT_BETTABLE', projection: { status: 'AVAILABLE' } });
    const base = 'https://api.the-odds-api.com/v4/sports/basketball_nba/events/odds-1/odds';
    expect(loaders.loadQuotes.mock.calls).toEqual(['h2h', 'spreads', 'totals', 'team_totals',
      'h2h,spreads,totals', 'h2h,spreads,totals,team_totals'].map(markets => [{
      cacheKey: `${base}?regions=us&markets=${markets}&oddsFormat=american`, binding, predictionAt,
    }]));
    expect(result.modeledGames[0]).not.toHaveProperty('quote');
    expect(result.modeledGames[0]).not.toHaveProperty('line');
    expect(result.modeledGames[0]).not.toHaveProperty('evPercent');
  });

  it('preserves a fresh actual quote, deduplicates cache hits, and stays PASS without readiness', async () => {
    const actualQuote = quote();
    const loaders = dependencies([actualQuote]);

    const result = await researchNBAGameLines([game()], [event()], loaders);

    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]).toMatchObject({ recommendationType: 'GAME', sport: 'nba', gameId: 'target',
      pickTier: 'PASS', availabilityVerified: false, marketKey: 'TOTAL', selection: 'OVER', line: 210.5,
      quote: actualQuote, assessment: { status: 'PRICED' }, projection: { status: 'AVAILABLE', predictionAt } });
    expect(result.recommendations[0].quote.americanOdds).toBe(-110);
    expect(result.recommendations[0].assessment.impliedProbability).toBeCloseTo(110 / 210);
    expect(result.recommendations[0].risks).toContain('Team availability, starting lineups or material conflicts remain unresolved; not recommendable.');
    expect(result.recommendations[0].projection).not.toHaveProperty('scenarios');
    expect(result.modeledGames[0].status).toBe('QUOTE_AVAILABLE');
    expect(loaders.loadQuotes).toHaveBeenCalledTimes(6);
  });

  it.each([
    ['completed', { completed: true }],
    ['already started', { gameTime: '2026-01-21T17:59:59Z' }],
    ['starting now', { gameTime: predictionAt }],
  ])('skips a %s game before loading research or quotes', async (_label, overrides) => {
    const loaders = dependencies([quote()]);

    expect(await researchNBAGameLines([game(overrides)], [event()], loaders)).toEqual({ recommendations: [], modeledGames: [] });
    expect(loaders.loadSnapshot).not.toHaveBeenCalled();
    expect(loaders.loadQuotes).not.toHaveBeenCalled();
  });

  it('does not publish a stale quote as a recommendation or quote-available research', async () => {
    const loaders = dependencies([quote({ updatedAt: '2026-01-21T16:59:59Z', observedAt: '2026-01-21T17:00:00Z' })]);

    const result = await researchNBAGameLines([game()], [event()], loaders);

    expect(result.recommendations).toEqual([]);
    expect(result.modeledGames[0]).toMatchObject({ status: 'MODELED_NOT_BETTABLE', projection: { status: 'AVAILABLE' } });
  });

  it('does not publish a quote received after the prediction cutoff', async () => {
    const loaders = dependencies([quote({ observedAt: '2026-01-21T18:00:01Z' })]);

    const result = await researchNBAGameLines([game()], [event()], loaders);

    expect(result.recommendations).toEqual([]);
    expect(result.modeledGames[0].status).toBe('MODELED_NOT_BETTABLE');
  });

  it('reports snapshot errors honestly without fabricating a projection or price', async () => {
    const loaders = dependencies([quote()]);
    loaders.loadSnapshot.mockRejectedValue(new Error('Snapshot unavailable'));

    const result = await researchNBAGameLines([game()], [event()], loaders);

    expect(result).toEqual({ recommendations: [], modeledGames: [{ recommendationType: 'GAME', gameId: 'target',
      home: { id: 1, name: 'Home', logoUrl: null }, away: { id: 2, name: 'Away', logoUrl: null }, projection: null, status: 'RESEARCH_UNAVAILABLE',
      reason: 'Cutoff-safe team research unavailable. No model or price was invented.' }] });
    expect(loaders.loadQuotes).not.toHaveBeenCalled();
  });

  it('keeps an insufficient historical sample unavailable rather than claiming a modeled game', async () => {
    const snapshot = historicalFixture().snapshot;
    snapshot.games = snapshot.games.slice(0, 9);
    const loaders = dependencies([], snapshot);

    const result = await researchNBAGameLines([game()], [], loaders);

    expect(result.recommendations).toEqual([]);
    expect(result.modeledGames[0]).toMatchObject({ status: 'RESEARCH_UNAVAILABLE',
      projection: { status: 'INSUFFICIENT_DATA', means: null } });
  });

  it('binds the target date when a same-team event on another date appears first', async () => {
    const wrongDate = event({ id: 'other-date', commenceTime: '2026-01-22T23:00:00Z' });
    const loaders = dependencies([quote()]);
    loaders.loadQuotes.mockImplementation(async input => ({ status: 'AVAILABLE', reason: null,
      quotes: [quote({ eventId: input.binding.eventId,
        commenceTime: input.binding.eventId === wrongDate.id ? wrongDate.commenceTime : game().gameTime })] }));

    const result = await researchNBAGameLines([game()], [wrongDate, event()], loaders);

    expect(loaders.loadQuotes.mock.calls.map(([input]) => input.binding)).toEqual(Array.from({ length: 6 }, () => binding));
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]).toMatchObject({ quote: { eventId: 'odds-1', commenceTime: game().gameTime },
      assessment: { status: 'PRICED' }, pickTier: 'PASS' });
  });

  it('does not publish a same-event quote with a different scheduled tipoff', async () => {
    const loaders = dependencies([quote({ commenceTime: '2026-01-21T23:30:00Z' })]);

    const result = await researchNBAGameLines([game()], [event()], loaders);

    expect(result.recommendations).toEqual([]);
    expect(result.modeledGames[0].status).toBe('MODELED_NOT_BETTABLE');
  });
});