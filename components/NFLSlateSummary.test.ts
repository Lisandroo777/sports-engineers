import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NFLSlateSummary } from './NFLSlateSummary';
import type { NFLSlateLedger } from '../lib/nfl/slateLedger';

describe('NFL user-facing research coverage', () => {
  it('never labels zero-market or failed games as researched', () => {
    const ledger = { expectedGames: 14, researchedGames: 11, eligiblePregame: 14, zeroMarketGames: 1, failedGames: 2, started: 0, final: 0, excluded: 0, researchComplete: false } as NFLSlateLedger;
    const markup = renderToStaticMarkup(createElement(NFLSlateSummary, { ledger }));
    expect(markup).toContain('11 / 14'); expect(markup).toContain('no supported markets'); expect(markup).toContain('Research incomplete');
    expect(markup).not.toContain('14 / 14'); expect(markup).not.toMatch(/credits|provider|API/);
  });
});