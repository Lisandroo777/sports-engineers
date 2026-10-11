import { describe, expect, it } from 'vitest';
import { buildNFLSeasonContext, classifyNFLSeasonPhase } from './seasonContext';
import type { NFLGameLogEntry } from './types';

function game(overrides: Partial<Parameters<typeof classifyNFLSeasonPhase>[0]> = {}) {
  return { season: 2026, week: 5, seasonType: 'REGULAR' as const, playoffRound: null, ...overrides };
}

function log(week: number, stats: Record<string, number>, overrides: Partial<NFLGameLogEntry> = {}): NFLGameLogEntry {
  return { gameId: `g-${week}`, season: 2026, teamId: 18, position: 'WR', week, date: `2026-10-${String(week).padStart(2, '0')}`,
    opponent: 'Opponent', opponentAbbreviation: 'OPP', homeAway: 'home', result: 'W', stats, ...overrides };
}

const context = (overrides: Partial<Parameters<typeof buildNFLSeasonContext>[0]> = {}) => buildNFLSeasonContext({
  game: game(), player: 'Receiver', playerTeamId: 18, position: 'WR', market: 'player_reception_yds', direction: 'over', line: 60,
  logs: [], roleStatus: 'STABLE', roleWorkloadTrend: 'WORKLOAD_STABLE', ...overrides,
});

describe('NFL season phase context', () => {
  it.each([[1, 'EARLY_REGULAR_SEASON'], [4, 'EARLY_REGULAR_SEASON'], [5, 'MID_REGULAR_SEASON'], [13, 'MID_REGULAR_SEASON'],
    [14, 'LATE_REGULAR_SEASON'], [18, 'LATE_REGULAR_SEASON']] as const)('classifies regular season week %s', (week, expected) => {
    expect(classifyNFLSeasonPhase(game({ week }))).toBe(expected);
  });

  it('classifies playoffs and preserves round only when the schedule provides it', () => {
    expect(classifyNFLSeasonPhase(game({ week: 19, seasonType: 'POSTSEASON', playoffRound: 'WILD_CARD' }))).toBe('PLAYOFFS');
    expect(context({ game: game({ week: 19, seasonType: 'POSTSEASON', playoffRound: 'DIVISIONAL' }) })).toMatchObject({ phase: 'PLAYOFFS', playoffRound: 'DIVISIONAL', projectionAdjustment: null });
    expect(classifyNFLSeasonPhase(game({ week: 5, seasonType: null }))).toBe('MID_REGULAR_SEASON');
    expect(classifyNFLSeasonPhase(game({ week: 19, seasonType: null }))).toBe('UNAVAILABLE');
    expect(classifyNFLSeasonPhase(game({ week: null, seasonType: null }))).toBe('UNAVAILABLE');
  });

  it('uses small current-season sample as uncertainty without treating prior season as equivalent', () => {
    const result = context({ game: game({ week: 3 }), logs: [log(1, { receivingYards: 70 }), log(2, { receivingYards: 82 }), log(3, { receivingYards: 95 })] });
    expect(result).toMatchObject({ phase: 'EARLY_REGULAR_SEASON', gameNumber: 4, gameNumberBasis: 'PLAYER_SEASON_APPEARANCE', impact: 'UNCERTAINTY', confidence: 'LOW', projectionAdjustment: null });
    expect(result.notes.join(' ')).toContain('only 3 current-season games');
    expect(result.missingData).toContain('coaching/coordinator tenure, offseason system changes, and scheme continuity across seasons');
  });

  it('reports exact-line phase samples descriptively only when at least three observations exist', () => {
    const logs = [log(1, { receivingYards: 70 }), log(2, { receivingYards: 82 }), log(3, { receivingYards: 95 }),
      log(4, { receivingYards: 65 }), log(5, { receivingYards: 75 }), log(6, { receivingYards: 80 }), log(7, { receivingYards: 73 })];
    const result = context({ game: game({ week: 7 }), logs });
    expect(result.phaseHistory.some((entry) => entry.includes('Mid Regular Season exact-line history'))).toBe(true);
    expect(result.notes.some((entry) => entry.includes('descriptive only'))).toBe(true);
    expect(result.projectionAdjustment).toBeNull();
    expect(result.impact).toBe('NEUTRAL');
  });

  it('does not compare phase samples across team or position changes', () => {
    const logs = [log(1, { receivingYards: 80 }, { teamId: 99 }), log(2, { receivingYards: 82 }, { teamId: 99 }), log(3, { receivingYards: 75 }, { teamId: 99 })];
    const result = context({ game: game({ week: 7 }), logs });
    expect(result.phaseHistory[0]).toContain('No sufficient mid regular season exact-line sample');
  });

  it('reports prior-season phase history only for matching team and position, and marks it descriptive', () => {
    const previous = [1, 2, 3].map((week) => log(week, { receivingYards: 72 + week }, { season: 2025, historySource: 'PREVIOUS_SEASON' }));
    const sameTeam = context({ game: game({ week: 3 }), logs: previous });
    expect(sameTeam.phaseHistory.some((entry) => entry.includes('Prior-season same-team/position early regular season exact-line history'))).toBe(true);
    expect(sameTeam.phaseHistory.some((entry) => entry.includes('descriptive only'))).toBe(true);
    const otherTeam = context({ game: game({ week: 3 }), logs: previous.map((entry) => ({ ...entry, teamId: 99 })) });
    expect(otherTeam.phaseHistory.some((entry) => entry.includes('Prior-season same-team/position'))).toBe(false);
  });

  it('does not infer rest, clinching, or playoff stakes from season phase', () => {
    const result = context({ game: game({ week: 18 }) });
    expect(result.phase).toBe('LATE_REGULAR_SEASON');
    expect(result.teamSituation).toBeNull();
    expect(result.missingData).toContain('team standings, clinching/elimination status, must-win context, and player rest/snap-limit intent');
    expect(result.notes.join(' ')).toContain('not inferred');
  });
});
