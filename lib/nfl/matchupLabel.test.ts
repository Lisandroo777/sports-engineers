import { describe, expect, it } from 'vitest';
import { nflMatchupLabel } from './matchupLabel';

describe('honest NFL matchup labels', () => {
  it('partial data never becomes favorable from opponent presence', () => {
    expect(nflMatchupLabel({ status: 'PARTIAL', assessment: 'FAVORABLE' })).toBe('PARTIAL DATA');
    expect(nflMatchupLabel({ status: 'AVAILABLE' })).toBe('NEUTRAL');
    expect(nflMatchupLabel(null)).toBe('UNAVAILABLE');
  });
  it('a directional assessment requires complete evidence', () => {
    expect(nflMatchupLabel({ status: 'AVAILABLE', assessment: 'UNFAVORABLE' })).toBe('UNFAVORABLE');
    expect(nflMatchupLabel({ status: 'AVAILABLE', assessment: 'FAVORABLE' })).toBe('FAVORABLE');
  });
});