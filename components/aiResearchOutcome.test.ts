import { describe, expect, it } from 'vitest';
import { classifyResearchFailure } from './aiResearchOutcome';

describe('AI research failure classification', () => {
  it.each([
    ['NO_GAMES', 'DATA_UNAVAILABLE'],
    ['NO_GAMES_SCHEDULED', 'DATA_UNAVAILABLE'],
    ['SLATE_COMPLETE', 'SLATE_COMPLETE'],
    ['EVENT_LIST_REQUIRED', 'DATA_UNAVAILABLE'],
    ['NO_CACHED_SPORTSBOOK_DATA', 'DATA_UNAVAILABLE'],
    ['MARKETS_NOT_POSTED', 'DATA_UNAVAILABLE'],
    ['PROVIDER_ERROR', 'CONNECTION_ERROR'],
    ['NOT_FOUND', 'CLARIFY'],
    ['INVALID_DATE', 'CLARIFY'],
    ['NO_ELITE_RESULTS', 'NO_ELITE_RESULTS'],
  ])('preserves the specific %s outcome even when research is incomplete', (status, expected) => {
    expect(classifyResearchFailure(status, false)).toBe(expected);
  });

  it.each(['RESERVE_BLOCKED', 'PAID_REFRESH_NOT_AUTHORIZED', 'SPORTSBOOK_DATA_REQUIRED', 'BUDGET_LIMITED'])(
    'retains the spending safety block for %s', status => {
      expect(classifyResearchFailure(status, false)).toBe('TEMP_UNAVAILABLE');
    });

  it('preserves genuinely incomplete research and successful ranking behavior', () => {
    expect(classifyResearchFailure('RESEARCH_INCOMPLETE', false)).toBe('RESEARCH_INCOMPLETE');
    expect(classifyResearchFailure('SUCCESS', false)).toBe('RESEARCH_INCOMPLETE');
    expect(classifyResearchFailure('SUCCESS', true)).toBeNull();
    expect(classifyResearchFailure('', undefined)).toBeNull();
  });
});