import { describe, expect, it } from 'vitest';
import { annotateNFLCorrelation } from './correlation';
import type { ResearchCandidateRecord } from '../ai/agent/session';

function pick(overrides: Partial<ResearchCandidateRecord> = {}): ResearchCandidateRecord {
  return { candidateId: 'one', player: 'Receiver', playerId: 1, gameId: 'game', team: 'Team', opponent: 'Opponent', marketKey: 'player_reception_yds',
    direction: 'over', line: 50.5, eliteQualified: true, researchScore: 90, rank: 1, ...overrides } as ResearchCandidateRecord;
}
describe('NFL correlation awareness without deleting plays', () => {
  it('labels same-player lines and teammate passing dependencies while preserving order and qualification', () => {
    const plays = [pick(), pick({ candidateId: 'two', line: 55.5, rank: 2 }), pick({ candidateId: 'qb', playerId: 2, player: 'QB', marketKey: 'player_pass_yds', rank: 3 })];
    const annotated = annotateNFLCorrelation(plays);
    expect(annotated).toHaveLength(3); expect(annotated.map(p => p.candidateId)).toEqual(plays.map(p => p.candidateId));
    expect(annotated.every(p => p.eliteQualified && p.researchScore === 90)).toBe(true);
    expect(annotated[0].correlationGroups?.map(g => g.kind)).toEqual(['SAME_OUTCOME', 'PASSING_ENVIRONMENT']);
    expect(annotated[2].correlationGroups?.[0].relatedPlays).toBe(3);
  });
  it('does not connect players on other teams/games or unrelated rushing markets', () => {
    const result = annotateNFLCorrelation([pick(), pick({ gameId: 'other', candidateId: 'other' }), pick({ candidateId: 'opp', team: 'Opponent' }), pick({ candidateId: 'rush', marketKey: 'player_rush_yds', playerId: 3 })]);
    expect(result.every(p => p.correlationGroups?.length === 0)).toBe(true);
  });
});