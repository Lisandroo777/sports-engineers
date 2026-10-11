import { describe, expect, it } from 'vitest';
import { buildNFLGameScriptResearch } from './gameScript';
import type { NFLGame } from './types';

const game: NFLGame = {
  id: 'game', week: 5, gameTime: '2026-10-11T17:00:00Z', homeTeam: { id: 1, name: 'Bills', displayName: 'Buffalo Bills', abbreviation: 'BUF', logoUrl: null, color: null },
  awayTeam: { id: 2, name: 'Jets', displayName: 'New York Jets', abbreviation: 'NYJ', logoUrl: null, color: null },
  homeScore: null, awayScore: null, completed: false, venue: { id: 'stadium', name: 'Stadium', indoor: false, city: 'Buffalo', state: 'NY', country: 'USA' },
  odds: [{ provider: 'DraftKings', homeSpread: -3.5, openingHomeSpread: -2.5, total: 47.5, openingTotal: 45.5, retrievedAt: '2026-10-05T12:00:00Z' }],
};

describe('NFL ESPN market-derived game script', () => {
  it('derives team totals from current game total/spread and keeps the favorite probabilistic', () => {
    const script = buildNFLGameScriptResearch(game, 1, '2026-10-05T12:01:00Z');
    expect(script.status).toBe('PARTIAL_DATA');
    expect(script.value).toMatchObject({ expectedLeader: 'Buffalo Bills', homeAway: 'HOME', spread: -3.5, total: 47.5,
      homeTeamTotal: 25.5, awayTeamTotal: 22, expectedMarginRange: { low: null, high: null, marketSpread: 3.5 },
      expectedPassPressure: 'HIGHER_IF_TRAILING', expectedRushOpportunity: 'HIGHER_IF_LEADING', expectedPossessions: null, confidence: 'LOW' });
    expect(script.value?.thesis).toContain('not certain');
    expect(script.value?.projectionImpact).toContain('no numeric projection adjustment');
    expect(script.provenance[0]).toMatchObject({ source: 'ESPN game odds · DraftKings', affectedTeam: 'Buffalo Bills' });
  });

  it('keeps spread-implied leader and script unknown when the scoreboard has no game lines', () => {
    const script = buildNFLGameScriptResearch({ ...game, odds: [] }, 2);
    expect(script.status).toBe('UNAVAILABLE');
    expect(script.value?.environmentModel).toMatchObject({ confidence: 'UNAVAILABLE', volumeAdjustment: 0 });
  });

  it('never turns favorite or underdog status into unsupported directional prop evidence', () => {
    const favorite = buildNFLGameScriptResearch(game, 1, '2026-10-05T12:00:00Z', 'player_rush_yds', 'over');
    const dog = buildNFLGameScriptResearch({ ...game, odds: [{ ...game.odds![0], homeSpread: 7 }] }, 1, '2026-10-05T12:00:00Z', 'player_rush_yds', 'over');
    const favoriteQB = buildNFLGameScriptResearch(game, 1, '2026-10-05T12:00:00Z', 'player_pass_yds', 'over');
    const underdogQB = buildNFLGameScriptResearch({ ...game, odds: [{ ...game.odds![0], homeSpread: 7 }] }, 1, '2026-10-05T12:00:00Z', 'player_pass_yds', 'over');
    expect(favorite.value?.candidateEvidence).toBeNull();
    expect(dog.value?.candidateEvidence).toBeNull();
    expect(favoriteQB.value?.candidateEvidence).toBeNull();
    expect(underdogQB.value?.candidateEvidence).toBeNull();
    expect(favorite.value?.projectionImpact).toBe(dog.value?.projectionImpact);
  });
  it('does not assign a candidate side when the player team is unresolved', () => {
    const result = buildNFLGameScriptResearch(game, null, '2026-10-05T12:01:00Z');
    expect(result.value?.thesis).toContain('candidate team is unknown');
    expect(result.value?.environmentModel?.inputs.teamTotal).toBeNull();
    expect(result.value?.environmentModel?.inputs.candidateSpread).toBeNull();
  });
  it('does not relabel an old market retrieval as fresh', () => {
    const result = buildNFLGameScriptResearch(game, 1, '2026-10-06T12:00:00Z');
    expect(result.provenance[0].retrievedAt).toBe('2026-10-05T12:00:00Z');
    expect(result.value?.environmentModel?.inputs.marketRetrievalStatus).toBe('STALE_RETRIEVAL');
    expect(result.value?.environmentModel?.confidence).toBe('UNAVAILABLE');
  });
});