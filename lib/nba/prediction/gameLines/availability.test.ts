import { describe, expect, it } from 'vitest';
import { historicalFixture } from './fixtures';
import { assessNBAGameAvailability } from './availability';

describe('NBA game availability evidence gate', () => {
  it('keeps missing intelligence and reports unresolved without guessing healthy starters', () => {
    const assessment = assessNBAGameAvailability(historicalFixture().snapshot, null);
    expect(assessment.injuriesVerified).toBe(false);
    expect(assessment.startingLineupsVerified).toBe(false);
    expect(assessment.impactReviewResolved).toBe(false);
    expect(assessment.teams.map(team => team.report)).toEqual(['MISSING', 'MISSING']);
    expect(assessment.teams.flatMap(team => team.confirmedStarterIds)).toEqual([]);
    expect(assessment.phase.verified).toBe(true);
    expect(assessment.phase).toMatchObject({ adapterVersion: 'NBA_AGENT2_CONTEXT_ADAPTER_V1', season: 2026, modelPhase: 'REGULAR' });
    expect(assessment.numericAdjustmentsApplied).toBe(false);
  });
});