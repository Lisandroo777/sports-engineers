import { describe, expect, it } from 'vitest';
import type { NBAObservedGame } from './types';
import { estimateNBAMarketOpportunity, estimateNBAMinutes } from './minutes';

function rows(values: number[], usage = 25): NBAObservedGame[] {
  return values.map((minutes, index) => ({ season: 2025, phase: 'REGULAR', source: 'fixture', log: { gameId: `g${index}`, date: `2025-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`,
    opponent: 'OPP', opponentAbbreviation: 'OPP', homeAway: 'home', result: 'W', stats: { minutes, points: minutes * usage / 100 } } }));
}

describe('NBA V1 minutes and opportunity uncertainty', () => {
  it('requires a real minutes sample and differentiates explicit availability states', () => {
    expect(estimateNBAMinutes({ observations: rows([30, 30, 29]), injury: 'REPORTED_AVAILABLE' }).mean).toBeNull();
    const failedFeed = estimateNBAMinutes({ observations: rows(Array(12).fill(30)), injury: 'FEED_UNAVAILABLE' });
    const missingReport = estimateNBAMinutes({ observations: rows(Array(12).fill(30)), injury: 'REPORT_MISSING' });
    expect(failedFeed.reliability).toBe('LOW');
    expect(missingReport.reliability).toBe('MEDIUM');
    expect(failedFeed.uncertainty).toBeGreaterThan(missingReport.uncertainty!);
  });

  it('weights recent rate/opportunity changes without fabricating a source', () => {
    const opportunity = estimateNBAMarketOpportunity({ marketValues: rows(Array(12).fill(30)).map(({ log, source }) => ({ value: log.stats.points!, minutes: 30, source })), expectedMinutes: 30 });
    expect(opportunity.reliability).toBe('PARTIAL');
    expect(opportunity.sources).toEqual(['fixture']);
    expect(opportunity.expectedOpportunity).toBeGreaterThan(0);
  });
});
