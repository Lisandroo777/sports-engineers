import { describe, expect, it } from 'vitest';
import { americanImpliedProbability, americanNetPayout, createSnapshot, gradeActual, predictionFingerprint } from './core';
import type { NFLLedgerCandidateInput } from './types';

function candidate(overrides: Partial<NFLLedgerCandidateInput> = {}): NFLLedgerCandidateInput {
  return { candidateId: 'c1', gameId: 'g1', playerId: 7, player: 'Example Player', teamId: 1, team: 'A', opponent: 'B',
    market: 'Passing Yards', marketKey: 'player_pass_yds', line: 250.5, direction: 'over', book: 'Book', odds: -110,
    projection: 270, trueProbability: 61, modelProbability: 58, edge: 19.5, evPercent: 8, researchScore: 88,
    trapRisk: 10, pickTier: 'NUKE', season: 2026, week: 5, game: { id: 'g1', gameTime: '2026-10-11T17:00:00Z', season: 2026, week: 5, seasonType: 'REGULAR', completed: false },
    nflResearchProfile: { researchMode: 'DEEP', sportFilterVersion: '1.0.0' }, ...overrides };
}

const metadata = { presentedAt: '2026-10-07T12:00:00Z', researchSessionId: 'session', rankingIntent: 'BEST' as const, researchMode: 'DEEP' as const,
  kickoff: { time: '2026-10-11T17:00:00Z', source: 'ESPN_SCOREBOARD' } };

describe('NFL prediction snapshot domain', () => {
  it('preserves the exact displayed snapshot and marks verified pregame status', () => {
    const snapshot = createSnapshot(candidate(), metadata, new Date('2026-10-07T12:01:00Z'));
    expect(snapshot).toMatchObject({ origin: 'FORWARD', scope: 'GLOBAL', modelVersion: 'NFL_MODEL_V1_1_HARDENED', gameId: 'g1', line: 250.5,
      americanOdds: -110, displayedProbability: 0.61, modelProbability: 0.58, tier: 'NUKE', pregameStatus: 'PREGAME_VALID',
      season: 2026, week: 5, seasonPhase: 'REGULAR', kickoffSource: 'ESPN_SCOREBOARD' });
  });

  it('never marks unknown or post-kickoff timestamps pregame-valid', () => {
    expect(createSnapshot(candidate(), { ...metadata, kickoff: null }, new Date('2026-10-07T12:01:00Z')).pregameStatus).toBe('KICKOFF_UNVERIFIED');
    expect(createSnapshot(candidate(), metadata, new Date('2026-10-11T17:00:00Z')).pregameStatus).toBe('POST_KICKOFF');
    expect(createSnapshot(candidate({ game: { ...candidate().game!, completed: true } }), metadata, new Date('2026-10-07T12:01:00Z')).pregameStatus).toBe('POST_KICKOFF');
  });

  it('deduplicates exact prices but separates materially changed price snapshots', () => {
    const first = createSnapshot(candidate(), metadata);
    const same = createSnapshot(candidate(), metadata);
    const changedLine = createSnapshot(candidate({ line: 251.5 }), metadata);
    const changedOdds = createSnapshot(candidate({ odds: 105 }), metadata);
    expect(predictionFingerprint(first)).toBe(predictionFingerprint(same));
    expect(new Set([first, changedLine, changedOdds].map((row) => predictionFingerprint(row))).size).toBe(3);
  });

  it('computes implied probabilities and one-unit American payouts', () => {
    expect(americanImpliedProbability(-110)).toBeCloseTo(110 / 210);
    expect(americanImpliedProbability(150)).toBeCloseTo(0.4);
    expect(americanNetPayout(-110)).toBeCloseTo(100 / 110);
    expect(americanNetPayout(150)).toBe(1.5);
  });

  it('grades strict OVER and UNDER comparisons and exact-line pushes', () => {
    expect(gradeActual(251, 250.5, 'over')).toBe('WIN');
    expect(gradeActual(250, 250.5, 'over')).toBe('LOSS');
    expect(gradeActual(249, 250, 'under')).toBe('WIN');
    expect(gradeActual(251, 250, 'under')).toBe('LOSS');
    expect(gradeActual(250, 250, 'over')).toBe('PUSH');
  });
});
