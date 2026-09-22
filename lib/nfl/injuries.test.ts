import { describe, expect, it } from 'vitest';
import { buildNFLInjuryContext, classifyNFLAvailability, evaluateNFLPlayerAvailability, isNFLPlayerAvailabilityKnown, parseNFLInjuryReports } from './injuries';

const now = new Date('2026-09-20T16:00:00Z');
const payload = {
  injuries: [{ id: '29', displayName: 'Carolina Panthers', injuries: [
    { athlete: { id: '4685720', displayName: 'Bryce Young', position: { abbreviation: 'QB' } }, status: 'Questionable', shortComment: 'Limited Friday with an ankle issue.', details: { detail: 'Ankle' }, date: '2026-09-18T18:00:00Z' },
    { athlete: { id: '900', displayName: 'Starting Tackle', position: { abbreviation: 'OT' } }, status: 'Out', shortComment: 'Ruled out.', details: { detail: 'Knee' }, date: '2026-09-19T18:00:00Z' },
    { athlete: { id: '901', displayName: 'Old Receiver', position: { abbreviation: 'WR' } }, status: 'Out', shortComment: 'Old report.', details: { detail: 'Hamstring' }, date: '2026-09-01T18:00:00Z' },
  ] }, { id: '1', displayName: 'Atlanta Falcons', injuries: [
    { athlete: { id: '800', displayName: 'Corner', position: { abbreviation: 'CB' } }, status: 'Doubtful', shortComment: 'Doubtful.', date: '2026-09-19T18:00:00Z' },
  ] }],
};

describe('NFL injury and availability context', () => {
  it('classifies only explicit availability designations', () => {
    expect(classifyNFLAvailability('Out')).toBe('OUT');
    expect(classifyNFLAvailability('Questionable')).toBe('QUESTIONABLE');
    expect(classifyNFLAvailability('Active')).toBe('AVAILABLE');
    expect(classifyNFLAvailability('Undisclosed')).toBe('UNKNOWN');
  });

  it('builds a fresh Bryce Young QB context with relevant OL and defensive absences', () => {
    const reports = parseNFLInjuryReports(payload, now);
    const context = buildNFLInjuryContext({ playerId: 4685720, player: 'Bryce Young', teamId: 29, team: 'Carolina Panthers', opponentTeamId: 1, market: 'player_pass_yds', position: 'QB', reports });
    expect(context.player.availabilityDesignation).toBe('QUESTIONABLE');
    expect(isNFLPlayerAvailabilityKnown(context)).toBe(true);
    expect(evaluateNFLPlayerAvailability(context).eligible).toBe(true);
    expect(context.teammateAbsences.map((entry) => entry.affectedRole)).toContain('OFFENSIVE_LINE');
    expect(context.opponentAbsences.map((entry) => entry.position)).toContain('CB');
    expect(context.teammateAbsences.some((entry) => entry.player === 'Old Receiver')).toBe(false);
  });

  it('keeps missing Bijan Robinson availability unknown while retaining relevant teammate facts', () => {
    const context = buildNFLInjuryContext({ playerId: 4430807, player: 'Bijan Robinson', teamId: 29, team: 'Carolina Panthers', opponentTeamId: 1, market: 'player_rush_yds', position: 'RB', reports: parseNFLInjuryReports(payload, now) });
    expect(context.player.availabilityDesignation).toBe('UNKNOWN');
    expect(context.player.sourceStatus).toBe('MISSING');
    expect(isNFLPlayerAvailabilityKnown(context)).toBe(false);
    expect(context.missingFields).toContain('current player availability');
  });

  it('never treats Drake London stale data as current', () => {
    const reports = parseNFLInjuryReports({ injuries: [{ id: '1', displayName: 'Atlanta Falcons', injuries: [
      { athlete: { id: '4426502', displayName: 'Drake London', position: { abbreviation: 'WR' } }, status: 'Active', date: '2026-09-01T12:00:00Z' },
    ] }] }, now);
    const context = buildNFLInjuryContext({ playerId: 4426502, player: 'Drake London', teamId: 1, team: 'Atlanta Falcons', opponentTeamId: 29, market: 'player_reception_yds', position: 'WR', reports });
    expect(context.sourceStatus.status).toBe('STALE');
    expect(context.player.availabilityDesignation).toBe('UNKNOWN');
    expect(isNFLPlayerAvailabilityKnown(context)).toBe(false);
  });

  it('fails official eligibility only for fresh OUT or DOUBTFUL player reports', () => {
    const reports = parseNFLInjuryReports({ injuries: [{ id: '29', displayName: 'Carolina Panthers', injuries: [
      { athlete: { id: '4685720', displayName: 'Bryce Young', position: { abbreviation: 'QB' } }, status: 'Out', date: '2026-09-20T15:00:00Z' },
    ] }] }, now);
    const context = buildNFLInjuryContext({ playerId: 4685720, player: 'Bryce Young', teamId: 29, team: 'Carolina Panthers', opponentTeamId: 1, market: 'player_pass_yds', position: 'QB', reports });
    expect(evaluateNFLPlayerAvailability(context)).toEqual({ eligible: false, reason: 'Player is listed OUT on the current ESPN injury report.' });
  });
});