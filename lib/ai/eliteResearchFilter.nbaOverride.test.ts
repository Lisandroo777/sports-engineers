import { describe, expect, it } from 'vitest';
import { analyzePickCandidate, type EliteCandidateInput } from './eliteResearchFilter';

function candidate(sport: 'nba' | 'nfl' | 'mlb', withOverride: boolean): EliteCandidateInput {
  const input: EliteCandidateInput = {
    candidateId: `${sport}-v1`, sport, playerId: 7, player: 'Fixture Player', market: sport === 'mlb' ? 'batter_hits' : sport === 'nfl' ? 'player_pass_yds' : 'points',
    line: 25, direction: 'over', isAlternate: false, projection: 30, projectionUncertainty: 4,
    historicalRates: [90, 80, 75, 70], sampleSize: 20, oddsAmerican: -110, marketFairProbability: null,
    matchupAvailable: true, usageAvailable: true, roleKnown: true, gameContextAvailable: true, opponentPersonnelAvailable: false,
    marketConfirmationAvailable: true, statusKnown: true, lastUpdatedAt: new Date().toISOString(), requiredMarketSupported: true,
    marketSupport: 'SUPPORTED', unsupportedSignals: ['projectionAgreement', 'opponentPersonnel'],
  };
  if (withOverride) input.nbaProbabilityOverride = { over: 0.7, under: 0.25, push: 0.05, expectedValuePercent: 38.6,
    fairAmericanOdds: -382, noVigMarketProbability: 0.5, eligibleForReview: true, modelVersion: 'NBA_MODEL_V1', validationStatus: 'UNVALIDATED' };
  return input;
}

describe('NBA V1 shared qualification bridge', () => {
  it('uses V1 conditional probability, push mass, no-vig market price, and push-aware EV for NBA only', () => {
    const analysis = analyzePickCandidate(candidate('nba', true));
    expect(analysis.modelProbability).toBeCloseTo(73.7, 1);
    expect(analysis.trueProbability).toBeCloseTo(73.7, 1);
    expect(analysis.pushProbabilityPercent).toBe(5);
    expect(analysis.evPercent).toBe(38.6);
    expect(analysis.fairAmericanOdds).toBe(-382);
    expect(analysis.marketFairProbability).toBe(50);
    expect(analysis.modelVersion).toBe('NBA_MODEL_V1');
    expect(analysis.validationStatus).toBe('UNVALIDATED');
    expect(analysis.eliteQualified).toBe(true);
  });

  it('fails NBA closed instead of falling back to the shared legacy probability model', () => {
    const analysis = analyzePickCandidate(candidate('nba', false));
    expect(analysis.modelProbability).toBeNull();
    expect(analysis.trueProbability).toBeNull();
    expect(analysis.evPercent).toBeNull();
    expect(analysis.eliteQualified).toBe(false);
    expect(analysis.rejectedReasons).toContain('NBA_MODEL_V1 projection/price did not pass its reliability and value pre-screen');
  });

  it.each(['nfl', 'mlb'] as const)('does not apply an NBA override to %s probability/qualification', (sport) => {
    expect(analyzePickCandidate(candidate(sport, true))).toEqual(analyzePickCandidate(candidate(sport, false)));
  });
});
