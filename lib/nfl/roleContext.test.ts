import { describe, it, expect } from 'vitest';
import { NFL_ROLE_REQUIREMENTS, assessNFLRoleStability, computeNFLOpportunityTrend, buildNFLRoleContext, buildNFLPlayerWorkloadProfile } from './roleContext';
import { projectNFLMarket } from './projection';
import type { NFLGameLogEntry } from './types';

function log(stats: Record<string, number>, index: number): NFLGameLogEntry {
  return { gameId: `g${index}`, week: index, date: new Date(Date.UTC(2024, 8, index + 1)).toISOString(), opponent: 'OPP', opponentAbbreviation: 'OPP', homeAway: 'home', result: 'W', stats };
}

describe('NFL market-by-market role requirement classification', () => {
  it('classifies QB volume markets as IMPORTANT', () => {
    expect(NFL_ROLE_REQUIREMENTS.player_pass_attempts).toBe('IMPORTANT');
    expect(NFL_ROLE_REQUIREMENTS.player_pass_yds).toBe('IMPORTANT');
  });
  it('classifies RB/WR/TE touch markets as CRITICAL', () => {
    expect(NFL_ROLE_REQUIREMENTS.player_rush_attempts).toBe('CRITICAL');
    expect(NFL_ROLE_REQUIREMENTS.player_receptions).toBe('CRITICAL');
    expect(NFL_ROLE_REQUIREMENTS.player_reception_yds).toBe('CRITICAL');
  });
  it('classifies explosive/fixed-role markets as OPTIONAL', () => {
    expect(NFL_ROLE_REQUIREMENTS.player_kicking_points).toBe('OPTIONAL');
    expect(NFL_ROLE_REQUIREMENTS.player_sacks).toBe('OPTIONAL');
  });
});

describe('NFL workload trend detection', () => {
  it('detects WORKLOAD_INCREASE from a real rising attempts pattern', () => {
    const logs = [
      ...Array.from({ length: 8 }, (_, i) => log({ rushingAttempts: 10 }, i)),
      ...Array.from({ length: 3 }, (_, i) => log({ rushingAttempts: 20 }, i + 8)),
    ];
    const trend = computeNFLOpportunityTrend(logs, 'player_rush_attempts');
    expect(trend.trend).toBe('WORKLOAD_INCREASE');
  });

  it('detects WORKLOAD_DECREASE from a real falling attempts pattern', () => {
    const logs = [
      ...Array.from({ length: 8 }, (_, i) => log({ rushingAttempts: 20 }, i)),
      ...Array.from({ length: 3 }, (_, i) => log({ rushingAttempts: 5 }, i + 8)),
    ];
    const trend = computeNFLOpportunityTrend(logs, 'player_rush_attempts');
    expect(trend.trend).toBe('WORKLOAD_DECREASE');
  });

  it('detects HIGH_WORKLOAD_VOLATILITY from erratic attempts', () => {
    const values = [2, 22, 3, 20, 4, 21, 5, 19, 3, 20];
    const logs = values.map((v, i) => log({ rushingAttempts: v }, i));
    const trend = computeNFLOpportunityTrend(logs, 'player_rush_attempts');
    expect(trend.trend).toBe('HIGH_WORKLOAD_VOLATILITY');
  });

  it('reports INSUFFICIENT_OPPORTUNITY_DATA with too few games', () => {
    const logs = [log({ rushingAttempts: 10 }, 0)];
    const trend = computeNFLOpportunityTrend(logs, 'player_rush_attempts');
    expect(trend.trend).toBe('INSUFFICIENT_OPPORTUNITY_DATA');
  });
});

describe('NFL current-season role stability', () => {
  it('labels a stable usage pattern only after an adequate current-season sample', () => {
    const logs = Array.from({ length: 8 }, (_, index) => log({ receivingTargets: 8 + (index % 2) }, index));
    expect(assessNFLRoleStability(logs, 'player_reception_yds').status).toBe('STABLE');
  });

  it('recognizes a consistent recent increase and decline', () => {
    const increasing = [...Array.from({ length: 6 }, (_, index) => log({ rushingAttempts: 10 }, index)),
      ...Array.from({ length: 3 }, (_, index) => log({ rushingAttempts: 16 }, index + 6))];
    const declining = [...Array.from({ length: 6 }, (_, index) => log({ rushingAttempts: 16 }, index)),
      ...Array.from({ length: 3 }, (_, index) => log({ rushingAttempts: 10 }, index + 6))];
    expect(assessNFLRoleStability(increasing, 'player_rush_attempts').status).toBe('INCREASING');
    expect(assessNFLRoleStability(declining, 'player_rush_attempts').status).toBe('DECLINING');
  });

  it('does not treat a one-game spike as a role shift and flags a changed team', () => {
    const oneSpike = [...Array.from({ length: 6 }, (_, index) => log({ receivingTargets: 8 }, index)),
      log({ receivingTargets: 20 }, 6), log({ receivingTargets: 8 }, 7), log({ receivingTargets: 8 }, 8)];
    expect(assessNFLRoleStability(oneSpike, 'player_reception_yds').status).toBe('UNCERTAIN');
    const changed = oneSpike.map((entry, index) => ({ ...entry, teamId: index >= 7 ? 99 : 1 }));
    expect(assessNFLRoleStability(changed, 'player_reception_yds').status).toBe('CHANGED');
  });

  it('keeps prior-season supplementation out of current-season stability comparisons', () => {
    const current = Array.from({ length: 3 }, (_, index) => log({ receivingTargets: 10 }, index));
    const prior = Array.from({ length: 8 }, (_, index) => ({ ...log({ receivingTargets: 2 }, index + 3), historySource: 'PREVIOUS_SEASON' as const }));
    expect(assessNFLRoleStability([...prior, ...current], 'player_reception_yds')).toMatchObject({ status: 'UNCERTAIN', games: 3 });
  });
});

describe('NFL role context and Projection Reliability V2', () => {
  it('CRITICAL market with insufficient opportunity data becomes UNRELIABLE (Elite false)', () => {
    // receivingYards is recorded (enough for the base projection) but the opportunity proxy
    // (receptions) is missing entirely — a real-world data gap, not an invented scenario.
    const logs = Array.from({ length: 6 }, (_, i) => log({ receivingYards: 60 }, i));
    const projection = projectNFLMarket({ logs, market: 'player_reception_yds' });
    expect(projection.status).toBe('OK');
    expect(projection.reliability).toBe('UNRELIABLE');
  });

  it('CRITICAL market with a genuinely stable, well-sampled workload can reach MEDIUM (not blanket-rejected)', () => {
    const logs = Array.from({ length: 12 }, (_, i) => log({ receivingTargets: 8, receptions: 6, receivingYards: 70 }, i));
    const roleContext = buildNFLRoleContext(logs, 'player_reception_yds');
    expect(roleContext.status).toBe('STABLE');
    const projection = projectNFLMarket({ logs, market: 'player_reception_yds', roleContext });
    expect(projection.status).toBe('OK');
    expect(['MEDIUM', 'LOW']).toContain(projection.reliability);
    expect(projection.reliability).not.toBe('HIGH'); // never HIGH: still a workload proxy, not a real snap/target feed
  });

  it('does not reject every NFL candidate — OPTIONAL markets are not capped by role status', () => {
    const logs = Array.from({ length: 3 }, (_, i) => log({ sacks: 1 }, i));
    const roleContext = buildNFLRoleContext(logs, 'player_sacks');
    const projection = projectNFLMarket({ logs, market: 'player_sacks', roleContext });
    expect(projection.status).toBe('OK');
    expect(projection.reliability).not.toBe('UNRELIABLE');
  });
});

describe('NFL player workload profiles from ESPN game-log fixtures', () => {
  it('summarizes Bryce Young passing and rushing opportunity without inventing starts', () => {
    const logs = Array.from({ length: 10 }, (_, i) => log({ passingAttempts: 30 + (i % 3), rushingAttempts: 4 + (i % 2) }, i));
    const profile = buildNFLPlayerWorkloadProfile(logs, 'QB');
    expect(profile.status).toBe('STABLE');
    expect(profile.opportunities.passingAttempts.season.games).toBe(10);
    expect(profile.opportunities.rushingAttempts.season.games).toBe(10);
    expect(profile.starterStatus).toBe('UNAVAILABLE');
    expect(profile.unavailableEvidence).toContain('confirmed starter status');
  });

  it('summarizes Bijan Robinson carries, targets, and receptions', () => {
    const logs = Array.from({ length: 10 }, (_, i) => log({ rushingAttempts: 16 + (i % 2), receivingTargets: 5, receptions: 4 }, i));
    const profile = buildNFLPlayerWorkloadProfile(logs, 'RB');
    expect(profile.opportunities.rushingAttempts.season.mean).toBe(16.5);
    expect(profile.opportunities.receivingTargets.season.mean).toBe(5);
    expect(profile.opportunities.receptions.season.mean).toBe(4);
    expect(profile.committeeStatus).toBe('UNAVAILABLE');
  });

  it('uses Drake London target opportunity rather than catches as a target-share substitute', () => {
    const logs = Array.from({ length: 10 }, (_, i) => log({ receivingTargets: 9, receptions: 6 }, i));
    const profile = buildNFLPlayerWorkloadProfile(logs, 'WR');
    expect(profile.opportunities.receivingTargets.season.mean).toBe(9);
    expect(buildNFLRoleContext(logs, 'player_reception_yds').opportunity.statKey).toBe('receivingTargets');
    expect(profile.unavailableEvidence).toContain('target share');
  });
});
