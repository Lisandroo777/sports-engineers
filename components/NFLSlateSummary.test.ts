import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NFLSlateSummary } from './NFLSlateSummary';
import type { NFLSlateLedger } from '../lib/nfl/slateLedger';
import { finishNFLSlateLedger } from '../lib/nfl/slateLedger';

function createLedger(researchedGames: number, missingStates: Array<{ state: NFLSlateLedger['games'][number]['state']; failure: NFLSlateLedger['games'][number]['failure'] }> = []) {
  return finishNFLSlateLedger({ sport: 'nfl', date: '2026-10-18', requestedMarkets: [],
    games: Array.from({ length: researchedGames + missingStates.length }, (_, index) => ({
      gameId: String(index), matchup: `Away ${index} @ Home ${index}`, kickoff: '2026-10-18T20:00:00Z',
      eligibility: 'PREGAME', state: 'RESEARCHED', eventId: null, returnedMarkets: [], zeroMarkets: [], failedMarkets: [],
      retrievedAt: null, expiresAt: null, failure: null, propsEvaluated: 0, fromCache: true,
      ...(index >= researchedGames ? missingStates[index - researchedGames] : {}),
    })),
  });
}

describe('NFL user-facing research coverage', () => {
  it('never labels zero-market or failed games as researched', () => {
    const ledger = { expectedGames: 14, researchedGames: 11, eligiblePregame: 14, zeroMarketGames: 1, failedGames: 2, started: 0, final: 0, excluded: 0, researchComplete: false } as NFLSlateLedger;
    const markup = renderToStaticMarkup(createElement(NFLSlateSummary, { ledger }));
    expect(markup).toContain('11 / 14'); expect(markup).toContain('no supported markets'); expect(markup).toContain('Partial coverage');
    expect(markup).not.toContain('14 / 14'); expect(markup).not.toMatch(/credits|provider|API/);
  });

  it('shows 10 of 12 researched games and names both missing matchups with safe reasons', () => {
    const ledger = createLedger(10, [{ state: 'FAILED', failure: 'EVENT_UNAVAILABLE' }, { state: 'FAILED', failure: 'AUTHENTICATION' }]);
    const markup = renderToStaticMarkup(createElement(NFLSlateSummary, { ledger }));
    expect(markup).toContain('10 / 12 pregame games researched');
    expect(markup).toContain('Partial coverage');
    expect(markup).toContain('Away 10 @ Home 10: Sportsbook event not listed');
    expect(markup).toContain('Away 11 @ Home 11: Provider authentication failed');
    expect(markup).not.toMatch(/Research incomplete|12 \/ 12|fully researched|research complete|EVENT_UNAVAILABLE|AUTHENTICATION|credits|API/);
  });

  it.each([
    ['ZERO_MARKETS', null, 'No supported markets posted'],
    ['NOT_FETCHED', null, 'Not fetched'],
    ['FAILED', 'STALE_PRICE', 'Quote stale'],
    ['FAILED', 'NETWORK', 'Request failed'],
  ] as const)('explains missing games in state %s with failure %s', (state, failure, reason) => {
    const markup = renderToStaticMarkup(createElement(NFLSlateSummary, { ledger: createLedger(1, [{ state, failure }]) }));
    expect(markup).toContain(`Away 1 @ Home 1: ${reason}`);
  });

  it('keeps the research incomplete warning when no games were researched', () => {
    const markup = renderToStaticMarkup(createElement(NFLSlateSummary, { ledger: createLedger(0, [{ state: 'FAILED', failure: 'NETWORK' }]) }));
    expect(markup).toContain('0 / 1 pregame games researched');
    expect(markup).toContain('Research incomplete');
    expect(markup).not.toContain('Partial coverage');
  });

  it('keeps complete coverage normal without a missing-game warning', () => {
    const markup = renderToStaticMarkup(createElement(NFLSlateSummary, { ledger: createLedger(12) }));
    expect(markup).toContain('12 / 12 pregame games researched');
    expect(markup).not.toMatch(/Partial coverage|Research incomplete|<ul/);
  });
});