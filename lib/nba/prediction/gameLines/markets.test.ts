import { describe, expect, it } from 'vitest';
import { projectNBAGame } from './model';
import { assessGameMarket, settleGameQuote } from './markets';
import { historicalFixture, binding, quote } from './fixtures';
import { normalizeNBAGameQuotes } from './quotes';

describe('Game-line quote arithmetic from joint scores', () => {
  it.each([
    [quote({ market: 'MONEYLINE', selection: 'HOME', line: null }), 'WIN'],
    [quote({ market: 'MONEYLINE', selection: 'AWAY', line: null }), 'LOSS'],
    [quote({ market: 'SPREAD', selection: 'HOME', line: -10 }), 'PUSH'],
    [quote({ market: 'SPREAD', selection: 'AWAY', line: 10.5 }), 'WIN'],
    [quote({ line: 210 }), 'PUSH'],
    [quote({ market: 'TEAM_TOTAL', team: 'HOME', selection: 'UNDER', line: 110.5 }), 'WIN'],
    [quote({ market: 'TEAM_TOTAL', team: 'AWAY', selection: 'OVER', line: 101 }), 'LOSS'],
  ] as const)('settles exact saved market and line', (entry, expected) => {
    expect(settleGameQuote({ homeScore: 110, awayScore: 100 }, entry)).toBe(expected);
  });
  it('calculates conditional fair odds and one-unit EV with push mass', () => {
    const model = projectNBAGame(historicalFixture());
    model.scenarios = [{ homeScore: 110, awayScore: 100, weight: 0.3 }, { homeScore: 111, awayScore: 100, weight: 0.5 }, { homeScore: 109, awayScore: 100, weight: 0.2 }];
    const assessment = assessGameMarket(model, quote({ line: 210, americanOdds: 120 }), binding);
    expect(assessment).toMatchObject({ status: 'PRICED', winProbability: 0.5, lossProbability: 0.2, pushProbability: 0.3, fairAmericanOdds: -250 });
    expect(assessment.evPercent).toBeCloseTo(40);
  });
  it('uses one joint model for coherent moneyline, spread, total and team-total probabilities', () => {
    const model = projectNBAGame(historicalFixture());
    const home = assessGameMarket(model, quote({ market: 'MONEYLINE', selection: 'HOME', line: null }), binding);
    const away = assessGameMarket(model, quote({ market: 'MONEYLINE', selection: 'AWAY', line: null }), binding);
    expect(home.winProbability! + away.winProbability!).toBeCloseTo(1);
    expect(home.winProbability).toBeCloseTo(model.homeWinProbability!);
    for (const entry of [quote(), quote({ market: 'SPREAD', selection: 'HOME', line: -8.5 }), quote({ market: 'TEAM_TOTAL', team: 'AWAY', line: 100 })]) {
      const assessment = assessGameMarket(model, entry, binding);
      expect(assessment.winProbability! + assessment.lossProbability! + assessment.pushProbability!).toBeCloseTo(1);
    }
  });
  it('fails quotes closed for missing prices, stale timestamps, future observations and wrong identities', () => {
    const model = projectNBAGame(historicalFixture());
    expect(assessGameMarket(model, null, binding).status).toBe('UNSUPPORTED_QUOTE');
    expect(assessGameMarket(model, quote({ updatedAt: '2026-01-21T16:00:00Z' }), binding).status).toBe('STALE_QUOTE');
    expect(assessGameMarket(model, quote({ observedAt: '2026-01-21T19:00:00Z' }), binding).status).toBe('STALE_QUOTE');
    expect(assessGameMarket(model, quote({ eventId: 'wrong' }), binding).status).toBe('IDENTITY_MISMATCH');
    expect(assessGameMarket(model, quote({ americanOdds: 0 }), binding).evPercent).toBeNull();
  });
  it('normalizes only actual provider game quotes; never maps props or quarter markets', () => {
    const result = normalizeNBAGameQuotes({ id: 'odds-1', home_team: 'Home', away_team: 'Away', commence_time: '2026-01-21T23:00:00Z', bookmakers: [
      { key: 'fixture', title: 'Fixture', markets: [
        { key: 'h2h', last_update: '2026-01-21T17:30:00Z', outcomes: [{ name: 'Home', price: -120 }, { name: 'Away', price: 100 }] },
        { key: 'team_totals', last_update: '2026-01-21T17:30:00Z', outcomes: [{ name: 'Under', description: 'Home', point: 110.5, price: -110 }] },
        { key: 'player_points', outcomes: [{ name: 'Over', description: 'Player', point: 20.5, price: -110 }] },
        { key: 'totals_q1', outcomes: [{ name: 'Over', point: 55, price: -110 }] },
      ] },
    ] }, '2026-01-21T17:31:00Z');
    expect(result.quotes).toHaveLength(3);
    expect(result.quotes[2]).toMatchObject({ market: 'TEAM_TOTAL', team: 'HOME', selection: 'UNDER', line: 110.5 });
    expect(result.unsupported).toEqual(expect.arrayContaining(['Unsupported provider market: player_points', 'Unsupported provider market: totals_q1']));
  });
});