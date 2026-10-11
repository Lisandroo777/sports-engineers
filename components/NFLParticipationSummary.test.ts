import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NFLParticipationSummary } from './NFLParticipationSummary';

describe('truthful NFL participation provenance', () => {
  it('shows expected status and source freshness without claiming official activation', () => {
    const html = renderToStaticMarkup(createElement(NFLParticipationSummary, { verdict: {
      designation: 'EXPECTED_AVAILABLE', confidence: 'MEDIUM', stage: 'FINAL_DESIGNATION', gameId: 'game',
      checkedAt: '2026-10-05T12:00:00Z', expiresAt: Date.parse('2026-10-05T12:15:00Z'), depthOrder: 1,
      evidence: [{ source: 'TEAM_ROSTER', fetchedAt: '2026-10-05T12:00:00Z', observedAt: '2026-10-05T12:00:00Z', status: 'CURRENT', detail: 'Expected participation; not officially confirmed active.' }],
      missingEvidence: ['official game-day active/inactive list'],
    } }));
    expect(html).toContain('EXPECTED AVAILABLE'); expect(html).toContain('MEDIUM'); expect(html).toContain('TEAM ROSTER');
    expect(html).toContain('Observed:'); expect(html).toContain('not officially confirmed'); expect(html).toContain('Unavailable:');
  });
});