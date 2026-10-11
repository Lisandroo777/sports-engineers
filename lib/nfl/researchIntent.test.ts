import { describe, expect, it } from 'vitest';
import { matchesNFLLowThreshold, parseNFLResearchIntent } from './researchIntent';
import { parseNFLRequestScope } from '../ai/agent/nflRequestScope';
import { parseCandidateSearchConstraints } from '../ai/agent/tools';

describe('NFL independent research intents', () => {
  it.each([
    ['Give me the best NFL props today', 'STANDARD', 'BEST', false],
    ['Give me the safest NFL props today', 'STANDARD', 'MOST_LIKELY', false],
    ['Give me the best value NFL props today', 'STANDARD', 'BEST_VALUE', false],
    ['Give me low-threshold NFL plays', 'STANDARD', 'MOST_LIKELY', true],
    ['Deep research the best NFL props today', 'DEEP', 'BEST', false],
    ['Deep research the safest NFL plays', 'DEEP', 'MOST_LIKELY', false],
    ['Deep research low-threshold NFL plays', 'DEEP', 'MOST_LIKELY', true],
  ])('parses %s', (query, researchMode, rankingIntent, lowThreshold) => {
    expect(parseNFLResearchIntent(query)).toEqual({ researchMode, rankingIntent, lowThreshold });
    expect(parseNFLRequestScope(query).playerQuery).toBeNull();
  });
  it.each(['best', 'safe', 'most likely', 'elite', 'nuke', 'high probability'])('does not infer deep mode from %s', (query) => {
    expect(parseNFLResearchIntent(query).researchMode).toBe('STANDARD');
  });
  it('compares line to production, not absolute numeric size or tier score', () => {
    expect(matchesNFLLowThreshold({ marketKey: 'player_receptions', direction: 'over', line: 3.5, projection: 3.6 })).toBe(false);
    expect(matchesNFLLowThreshold({ marketKey: 'player_pass_yds', direction: 'over', line: 174.5, projection: 250 })).toBe(true);
    expect(matchesNFLLowThreshold({ marketKey: 'player_pass_yds', direction: 'over', line: 0, projection: null })).toBe(false);
  });
  it.each([2, 3])('keeps %s-man requests Standard and limits returned legs', (count) => {
    const query = `Give me a ${count}-man NFL`;
    expect(parseNFLRequestScope(query).playerQuery).toBeNull();
    expect(parseCandidateSearchConstraints(query, [], 'nfl')).toMatchObject({ researchMode: 'STANDARD', maxResults: count });
  });
});