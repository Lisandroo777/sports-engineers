import { describe, expect, it } from 'vitest';
import { getSportFilterRegistration, isSportResearchImplemented, SPORT_FILTER_REGISTRY } from './sportFilterRegistry';

describe('sport-specific research filter registry', () => {
  it('routes NFL only to the versioned NFL research model', () => {
    expect(getSportFilterRegistration('nfl')).toMatchObject({ sportFilter: 'NFL', filterId: 'NFL_FILTER', version: '1.0.0', implementation: 'NFL_RESEARCH_MODEL' });
  });

  it('preserves existing NBA and MLB engines without routing them through NFL', () => {
    expect(getSportFilterRegistration('nba')?.implementation).toBe('EXISTING_NBA_ENGINE');
    expect(getSportFilterRegistration('mlb')?.implementation).toBe('EXISTING_MLB_ENGINE');
    expect(SPORT_FILTER_REGISTRY.nba.filterId).not.toBe(SPORT_FILTER_REGISTRY.nfl.filterId);
    expect(SPORT_FILTER_REGISTRY.mlb.filterId).not.toBe(SPORT_FILTER_REGISTRY.nfl.filterId);
  });

  it('registers tennis and MLS without silently inheriting another sport engine', () => {
    for (const sport of ['tennis', 'mls', 'soccer']) {
      expect(getSportFilterRegistration(sport)?.implementation).toBe('NOT_IMPLEMENTED');
      expect(isSportResearchImplemented(sport)).toBe(false);
    }
  });

  it('rejects unknown and prototype-like sport names', () => {
    expect(getSportFilterRegistration('basketball-ish')).toBeNull();
    expect(getSportFilterRegistration('toString')).toBeNull();
    expect(isSportResearchImplemented('constructor')).toBe(false);
  });
});