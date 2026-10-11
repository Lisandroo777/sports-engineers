import { describe, expect, it } from 'vitest';
import { classifyNBAMarketIntent } from '../marketIntent';

describe('integrated NBA market routing', () => {
  it.each([
    ['Best NBA moneylines', ['MONEYLINE']],
    ['Best NBA spreads', ['SPREAD']],
    ['Best NBA totals', ['FULL_GAME_TOTAL']],
    ['Best NBA team totals', ['TEAM_TOTAL']],
    ['Best NBA game lines', ['MONEYLINE', 'SPREAD', 'FULL_GAME_TOTAL', 'TEAM_TOTAL']],
    ['Best NBA first-half spreads', ['FIRST_HALF']],
    ['Best NBA first quarter totals', ['FIRST_QUARTER']],
  ])('preserves market/period identity for %s', (query, markets) => {
    expect(classifyNBAMarketIntent(query)).toMatchObject({ gameLineMarkets: markets, gameLinesOnly: true });
  });
  it('keeps explicit mixed requests mixed and broad NBA requests within supported game periods', () => {
    expect(classifyNBAMarketIntent('Best NBA moneylines and player props')).toMatchObject({ playerPropsRequested: true, gameLinesOnly: false });
    expect(classifyNBAMarketIntent('Best NBA picks').gameLineMarkets).toEqual(['MONEYLINE', 'SPREAD', 'FULL_GAME_TOTAL', 'TEAM_TOTAL']);
    expect(classifyNBAMarketIntent('Best NBA player props').gameLineMarkets).toEqual([]);
  });
});