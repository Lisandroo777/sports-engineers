import { describe, expect, it } from 'vitest';
import { historicalFixture } from './fixtures';
import { assessNBAGameAvailability } from './availability';
import { availabilityFixture, starterIds } from './availability.fixtures';

describe('NBA game availability evidence gate', () => {
  it('supports verified future participation without calling projected starters confirmed', () => {
    const fixture = availabilityFixture('projected');
    for (const game of fixture.snapshot.games) for (const [index, team] of game.teams.entries()) {
      team.players = starterIds[index].map(playerId => ({ ...structuredClone(team.players[0]), playerId }));
    }
    const assessment = assessNBAGameAvailability(fixture.snapshot, fixture.intelligence);
    expect(assessment.startingLineupsVerified).toBe(false);
    expect(assessment.teams.every(team => team.lineup === 'PROJECTED')).toBe(true);
    expect(assessment.futureLineupVerified).toBe(true);
    expect(assessment.impactReviewResolved).toBe(true);
    expect(Date.parse(assessment.expiresAt!)).toBeLessThanOrEqual(Date.parse(fixture.snapshot.target.startsAt) - 90 * 60000);
  });
  it('keeps a projected lineup blocked when only one rotation player has observed history', () => {
    const fixture = availabilityFixture('projected');
    expect(assessNBAGameAvailability(fixture.snapshot, fixture.intelligence).futureLineupVerified).toBe(false);
  });
  it('does not substitute future lineup evidence for missing reports or uncertain players', () => {
    for (const scenario of ['questionable', 'missing', 'restriction', 'meaningfulOUT'] as const) {
      const fixture = availabilityFixture(scenario);
      expect(assessNBAGameAvailability(fixture.snapshot, fixture.intelligence).futureLineupVerified).toBe(false);
    }
  });
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