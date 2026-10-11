import { describe, expect, it } from 'vitest';
import { buildAvailability } from './availability';
import { fixtureEnvironment, fixtureSource } from './fixtures';

describe('availability source semantics', () => {
  it('keeps no-report and failed feeds unknown instead of active', () => {
    const env = fixtureEnvironment();
    expect(buildAvailability(env)).toMatchObject({ status: 'NOT_REPORTED', state: 'UNKNOWN' });
    const failed = fixtureEnvironment();
    failed.snapshot.injuryFeed.state = 'UNAVAILABLE';
    expect(buildAvailability(failed).status).toBe('UNKNOWN');
  });
  it('preserves probable, freshness and equal-time conflicts', () => {
    const env = fixtureEnvironment();
    env.snapshot.injuries = [{ playerId: 10, teamId: 1, status: 'PROBABLE', rawStatus: 'Probable', comment: null, source: fixtureSource() }];
    expect(buildAvailability(env).status).toBe('PROBABLE');
    const conflict = fixtureEnvironment();
    conflict.snapshot.injuries = [...env.snapshot.injuries, { ...env.snapshot.injuries[0], status: 'OUT' }];
    expect(buildAvailability(conflict).state).toBe('CONFLICTED');
    const late = fixtureEnvironment();
    late.snapshot.injuries = [{ ...env.snapshot.injuries[0], source: { ...fixtureSource(), fetchedAt: '2026-01-22T12:00:00Z' } }];
    expect(buildAvailability(late).status).toBe('UNKNOWN');
  });
});