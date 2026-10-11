import { describe, expect, it } from 'vitest';
import { buildNFLInjuryContext, classifyNFLInjuryFreshness, NFL_INJURY_CLOCK_SKEW_MS, NFL_INJURY_FRESHNESS_MS } from './injuries';

const startedAt = new Date('2026-10-05T05:53:39.189Z');
const fetchedAt = '2026-10-05T05:53:39.290Z';

describe('NFL injury snapshot clock semantics', () => {
  it('the exact 101ms fetch-after-request-start condition is current in both requests', () => {
    const params = { playerId: 1, player: 'Fixture Player', teamId: 18, team: 'New Orleans Saints', opponentTeamId: 1,
      market: 'player_pass_yds' as const, position: 'QB', reports: [], sourceAvailable: true,
      snapshot: { reports: [], complete: true, sourceStatus: 'CURRENT' as const, fetchedAt } };
    const first = buildNFLInjuryContext({ ...params, now: startedAt });
    const repeat = buildNFLInjuryContext({ ...params, now: new Date('2026-10-05T05:55:36.232Z') });
    expect(first.sourceStatus.status).toBe('CURRENT');
    expect(repeat.sourceStatus.status).toBe('CURRENT');
    expect(first.player.availabilityDesignation).toBe('NO_CURRENT_INJURY_DESIGNATION');
    expect(repeat.player.availabilityDesignation).toBe(first.player.availabilityDesignation);
  });

  it('a newly stamped explicit injury report is not hidden by millisecond clock skew', () => {
    expect(classifyNFLInjuryFreshness(fetchedAt, startedAt)).toBe('CURRENT');
  });

  it('bounds the skew allowance and rejects genuinely future timestamps', () => {
    expect(classifyNFLInjuryFreshness(new Date(startedAt.getTime() + NFL_INJURY_CLOCK_SKEW_MS).toISOString(), startedAt)).toBe('CURRENT');
    expect(classifyNFLInjuryFreshness(new Date(startedAt.getTime() + NFL_INJURY_CLOCK_SKEW_MS + 1).toISOString(), startedAt)).toBe('STALE');
    expect(classifyNFLInjuryFreshness('2027-10-05T05:53:39Z', startedAt)).toBe('STALE');
  });

  it('preserves expiry and invalid/missing timestamp handling', () => {
    expect(classifyNFLInjuryFreshness(new Date(startedAt.getTime() - NFL_INJURY_FRESHNESS_MS).toISOString(), startedAt)).toBe('CURRENT');
    expect(classifyNFLInjuryFreshness(new Date(startedAt.getTime() - NFL_INJURY_FRESHNESS_MS - 1).toISOString(), startedAt)).toBe('STALE');
    expect(classifyNFLInjuryFreshness('invalid', startedAt)).toBe('STALE');
    expect(classifyNFLInjuryFreshness(null, startedAt)).toBe('MISSING');
  });
});