import { describe, expect, it } from 'vitest';
import { buildMarketViews, buildPlayerOpportunity } from './marketViews';
import { buildRotation } from './rotation';
import { fixtureEnvironment } from './fixtures';

describe('market-specific evidence views', () => {
  it('combines evidence references without duplicating minutes or attempt share', () => {
    const env = fixtureEnvironment();
    buildRotation(env);
    buildPlayerOpportunity(env);
    const views = buildMarketViews(env);
    expect(views['3pm'].evidenceIds).toContain('opportunity.tpa');
    expect(views.assists.evidenceIds).not.toContain('opportunity.fga');
    expect(views.pra.evidenceIds.filter(id => id === 'rotation.minutes.l10')).toHaveLength(1);
    expect(views.pra.correlationGroups.filter(group => group === 'minutes.role')).toHaveLength(1);
    expect(env.evidence.find(entry => entry.id === 'opportunity.shotShare')?.correlationGroup).toBe('opportunity.fga');
  });
  it('does not relabel boxscore assists and rebounds as tracking metrics', () => {
    const env = fixtureEnvironment();
    buildPlayerOpportunity(env);
    expect(env.evidence.find(entry => entry.id === 'opportunity.potentialAssists')?.kind).toBe('UNAVAILABLE');
    expect(env.evidence.find(entry => entry.id === 'opportunity.reboundChances')?.value).toBeNull();
  });
});