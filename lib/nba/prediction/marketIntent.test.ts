import { describe, expect, it } from 'vitest';
import { classifyNBAMarketIntent, unsupportedNBAGameLineNotice } from './marketIntent';

describe('NBA supported-market intent without fabricated game lines', () => {
  it.each([
    ['Best NBA moneylines', ['MONEYLINE']],
    ['Best NBA spreads', ['SPREAD']],
    ['Best NBA game totals', ['FULL_GAME_TOTAL']],
    ['Best NBA team totals', ['TEAM_TOTAL']],
    ['Best NBA first half lines', ['FIRST_HALF']],
    ['Best NBA first quarter lines', ['FIRST_QUARTER']],
  ])('marks %s as unsupported game-line research', (query, expected) => {
    const intent = classifyNBAMarketIntent(query);
    expect(intent.gameLinesOnly).toBe(true);
    expect(intent.gameLineMarkets).toEqual(expected);
    expect(unsupportedNBAGameLineNotice(intent.gameLineMarkets)).toMatch(/no connected, timestamped sportsbook game-line quote/);
  });

  it('keeps player props separate and supports mixed/all-market requests without substituting them for requested game lines', () => {
    expect(classifyNBAMarketIntent('Best NBA player props today')).toMatchObject({ gameLineMarkets: [], playerPropsRequested: true, gameLinesOnly: false });
    expect(classifyNBAMarketIntent('Best NBA props and spreads')).toMatchObject({ gameLineMarkets: ['SPREAD'], playerPropsRequested: true, gameLinesOnly: false });
    expect(classifyNBAMarketIntent('Best NBA picks across all markets')).toMatchObject({ allMarketsRequested: true, gameLinesOnly: false });
  });
});
