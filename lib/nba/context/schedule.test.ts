import { describe, expect, it } from 'vitest';
import { basketballDate, buildSchedule } from './schedule';
import { fixtureEnvironment, fixtureGame } from './fixtures';

describe('basketball schedule context', () => {
  it('uses Eastern basketball date for late UTC games and scheduled back-to-backs', () => {
    expect(basketballDate('2026-01-20T02:00:00Z')).toBe('2026-01-19');
    const env = fixtureEnvironment([fixtureGame(20)]);
    buildSchedule(env);
    expect(env.evidence.find(entry => entry.id === 'schedule.rest')?.value).toMatchObject({ backToBack: true, interveningDays: 0 });
  });
  it('discloses partial density and does not infer distance or neutral home court', () => {
    const env = fixtureEnvironment();
    env.snapshot.target.neutralSite = true;
    expect(buildSchedule(env).homeAway).toBe('UNKNOWN');
    expect(env.evidence.find(entry => entry.id === 'schedule.rest')?.state).toBe('PARTIAL');
    expect(env.evidence.find(entry => entry.id === 'schedule.travel')?.detail).toContain('fatigue effects unavailable');
  });
});