import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NFLSportsbookPrices } from './NFLSportsbookPrices';

describe('NFL alternate sportsbook comparison', () => {
  it('displays one selected best price with alternate book prices', () => {
    const markup = renderToStaticMarkup(createElement(NFLSportsbookPrices, { primary: 'FanDuel', prices: [
      { candidateId: 'one', sportsbook: 'FanDuel', odds: -113, eliteQualified: true },
      { candidateId: 'two', sportsbook: 'BetMGM', odds: -115, eliteQualified: true },
    ] }));
    expect(markup).toContain('Selected best price'); expect(markup).toContain('BetMGM'); expect(markup).toContain('-115');
    expect(markup).not.toContain('Elite Pick');
  });
});