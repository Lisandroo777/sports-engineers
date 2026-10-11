import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NFLHistorySummary } from './NFLHistorySummary';
import { buildNFLHistory } from '../lib/nfl/history';

describe('NFL history labels', () => {
  it('renders actual observation counts, separate sources, and pushes', () => {
    const history = buildNFLHistory([34, 35, 36].map((value, index) => ({ gameId: String(index), season: 2026, week: index + 1,
      date: `2026-09-0${index + 1}`, opponent: 'OPP', opponentAbbreviation: 'OPP', homeAway: 'home', result: 'W', stats: { passingAttempts: value } })), 'player_pass_attempts', 35, 'over');
    const markup = renderToStaticMarkup(createElement(NFLHistorySummary, { history }));
    expect(markup).toContain('Current season 2026');
    expect(markup).toContain('Previous season 2025');
    expect(markup).toContain('Rolling sample');
    expect(markup).toContain('Pushes');
    expect(markup).toContain('3 / 3');
    expect(markup).toContain('50%');
  });
});