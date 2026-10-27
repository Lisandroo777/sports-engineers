import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NBAHistoricalDemo } from './NBAHistoricalDemo';
import { DEFAULT_NBA_RESEARCH_FILTER } from '../lib/nba/researchMarkets';

describe('NBA historical/test demo control', () => {
  it('starts collapsed, labels synthetic data clearly, and exposes no market results before explicit action', () => {
    const html = renderToStaticMarkup(<NBAHistoricalDemo filter={DEFAULT_NBA_RESEARCH_FILTER} />);
    expect(html).toContain('Show NBA test fixtures');
    expect(html).not.toContain('DEMO-NOT-A-REAL-GAME');
    expect(html).not.toContain('Sportsbook ·');
  });
});