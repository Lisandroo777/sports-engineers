import { describe, expect, it } from 'vitest';
import { evaluateNFLParticipation, nflParticipationTtlMs, parseNFLDepthEvidence, parseNFLRosterEvidence, parseNFLGameRoster, type NFLParticipationSnapshot } from './participation';
import { parseNFLInjuryReports, type NFLInjurySnapshot } from './injuries';

const now = new Date('2026-10-05T12:00:00Z');
function snapshot(): NFLParticipationSnapshot {
  return { gameId: 'game', kickoff: '2026-10-06T00:15:00Z', fetchedAt: now.toISOString(), expiresAt: now.getTime() + 900000,
    gameVerified: true, teamIds: [1, 18], failures: [],
    rosters: [{ teamId: 1, timestamp: now.toISOString(), complete: true, athletes: [{ id: '10', status: { name: 'Active' }, injuries: [] }] }],
    depthCharts: [{ teamId: 1, timestamp: now.toISOString(), complete: true, athletes: [{ id: '10', position: 'QB', order: 1, injuries: [] }] }],
    gameInjuries: [{ teamId: 1, complete: true, reports: [] }] };
}
function injuries(status?: string, date = now.toISOString()): NFLInjurySnapshot {
  return { fetchedAt: now.toISOString(), complete: true, sourceStatus: 'CURRENT', reports: parseNFLInjuryReports({ injuries: [{ id: '1', injuries: status ? [{ athlete: { id: '10' }, status, date }] : [] }] }, now) };
}
function evaluate(data = snapshot(), injury: NFLInjurySnapshot | null = injuries()) {
  return evaluateNFLParticipation({ playerId: 10, teamId: 1, position: 'QB', snapshot: data, injuries: injury, now });
}

describe('game-aware NFL participation evidence', () => {
  it('requires explicit exact-game active evidence inside the game-day window', () => {
    const data = snapshot(); data.kickoff = '2026-10-05T13:00:00Z';
    data.gameRosters = [{ teamId: 1, complete: true, activePlayerIds: [10], inactivePlayerIds: [11] }];
    expect(evaluate(data).designation).toBe('CONFIRMED_AVAILABLE');
    expect(evaluate(data, injuries('Out')).designation).toBe('OUT');
    data.gameRosters[0].activePlayerIds = [11]; data.gameRosters[0].inactivePlayerIds = [10];
    expect(evaluate(data).designation).toBe('INACTIVE');
  });
  it('does not promote all-false unpublished rosters or mismatched identities into evidence', () => {
    const raw = { competition: { $ref: 'https://sports.core.api.espn.com/v2/events/game/competitions/game' },
      team: { $ref: 'https://sports.core.api.espn.com/v2/teams/1' }, entries: [{ playerId: 10, valid: true, active: false }] };
    expect(parseNFLGameRoster(raw, 'game', 1).complete).toBe(false);
    raw.entries[0].active = true;
    expect(parseNFLGameRoster(raw, 'game', 1).activePlayerIds).toEqual([10]);
    expect(parseNFLGameRoster(raw, 'other', 1).complete).toBe(false);
  });
  it('establishes expected availability without an individual injury entry', () => {
    const verdict = evaluate(); expect(verdict.designation).toBe('EXPECTED_AVAILABLE'); expect(verdict.confidence).toBe('MEDIUM');
    expect(verdict.evidence.map((entry) => entry.source)).toEqual(expect.arrayContaining(['TEAM_ROSTER', 'DEPTH_CHART', 'GAME_PREVIEW']));
    expect(verdict.evidence.at(-1)?.detail).toContain('not officially confirmed');
  });
  it('does not trust stale Active but uses independently fresh participation evidence', () => {
    const verdict = evaluate(snapshot(), injuries('Active', '2026-09-25T12:00:00Z'));
    expect(verdict.designation).toBe('EXPECTED_AVAILABLE');
    expect(verdict.evidence.find((entry) => entry.source === 'INJURY_REPORT')?.status).toBe('STALE');
  });
  it.each(['Out', 'Doubtful', 'Questionable', 'Inactive'])('current %s overrides active roster and depth chart', (status) => {
    expect(evaluate(snapshot(), injuries(status)).designation).toBe(status.toUpperCase());
  });
  it('current game injury report overrides generic roster presence', () => {
    const data = snapshot(); data.gameInjuries[0].reports = [{ athlete: { id: '10' }, status: 'Out', date: now.toISOString() }];
    expect(evaluate(data).designation).toBe('OUT');
  });
  it('does not upgrade an unresolved stale negative designation', () => {
    expect(evaluate(snapshot(), injuries('Out', '2026-09-25T12:00:00Z')).designation).toBe('UNKNOWN');
  });
  it('rejects current roster inactive status without using old injury dates', () => {
    const data = snapshot(); data.rosters[0].athletes[0].status = { name: 'Inactive' };
    expect(evaluate(data).designation).toBe('INACTIVE');
  });
  it('roster absence is unknown, not active or provider failure', () => {
    const data = snapshot(); data.rosters[0].athletes = [];
    expect(evaluate(data).designation).toBe('UNKNOWN');
  });
  it('wrong game/team or position cannot establish expected participation', () => {
    const data = snapshot(); data.teamIds = [18, 2]; expect(evaluate(data).designation).toBe('UNKNOWN');
    data.teamIds = [1, 18]; data.depthCharts[0].athletes[0].position = 'WR'; expect(evaluate(data).designation).toBe('UNKNOWN');
  });
  it('injury feed failure can use an independent current game-specific restriction check', () => {
    const verdict = evaluate(snapshot(), null);
    expect(verdict.designation).toBe('EXPECTED_AVAILABLE');
    expect(verdict.evidence.find((entry) => entry.source === 'INJURY_REPORT')?.status).toBe('FAILED');
    expect(verdict.evidence.find((entry) => entry.source === 'GAME_INJURY_REPORT')?.status).toBe('CURRENT');
  });
  it('data failure remains insufficient when no restriction source succeeded', () => {
    const data = snapshot(); data.gameInjuries = []; data.failures.push('game injuries');
    expect(evaluate(data, null).designation).toBe('DATA_FAILURE');
  });
  it('stale or incomplete roster/depth data cannot be treated as fresh', () => {
    const data = snapshot(); data.rosters[0].timestamp = '2026-10-04T12:00:00Z'; expect(evaluate(data).designation).toBe('UNKNOWN');
    data.rosters[0].timestamp = now.toISOString(); data.depthCharts[0].complete = false; expect(evaluate(data).designation).toBe('UNKNOWN');
  });
  it('does not cache expected availability through the game-day inactive-list window', () => {
    const data = snapshot(); data.kickoff = '2026-10-05T13:00:00Z';
    const verdict = evaluate(data); expect(verdict.stage).toBe('GAME_DAY'); expect(verdict.designation).toBe('UNKNOWN');
    expect(verdict.expiresAt).toBeLessThanOrEqual(now.getTime() + 300000);
  });

  it('expires a weaker expected verdict exactly at the stronger-evidence window', () => {
    const data = snapshot(); data.kickoff = '2026-10-05T13:35:00Z';
    const verdict = evaluate(data);
    expect(verdict.designation).toBe('EXPECTED_AVAILABLE');
    expect(verdict.expiresAt).toBe(Date.parse(data.kickoff) - 90 * 60000);
  });

  it('new current OUT evidence replaces an earlier expected verdict', () => {
    expect(evaluate().designation).toBe('EXPECTED_AVAILABLE');
    expect(evaluate(snapshot(), injuries('Out')).designation).toBe('OUT');
  });
  it('rejects an expired snapshot and uses availability-specific TTLs', () => {
    const data = snapshot(); data.expiresAt = now.getTime() - 1; expect(evaluate(data).designation).toBe('DATA_FAILURE');
    expect(nflParticipationTtlMs('2026-10-09T12:00:00Z', now.getTime())).toBe(21600000);
    expect(nflParticipationTtlMs('2026-10-07T12:00:00Z', now.getTime())).toBe(3600000);
    expect(nflParticipationTtlMs('2026-10-06T00:15:00Z', now.getTime())).toBe(900000);
  });
  it('parses only the actual team roster and structured depth chart', () => {
    expect(parseNFLRosterEvidence({ timestamp: now.toISOString(), team: { id: '1' }, athletes: [{ items: [{ id: '10', status: { name: 'Active' }, injuries: [] }] }] }, 1).complete).toBe(true);
    expect(parseNFLRosterEvidence({ team: { id: '18' }, athletes: [] }, 1).complete).toBe(false);
    const depth = parseNFLDepthEvidence({ team: { id: '1' }, depthchart: [{ positions: { qb: { position: { abbreviation: 'QB' }, athletes: [{ id: '10', injuries: [] }] } } }] }, 1);
    expect(depth.athletes[0]).toMatchObject({ id: '10', position: 'QB', order: 1 });
  });
});