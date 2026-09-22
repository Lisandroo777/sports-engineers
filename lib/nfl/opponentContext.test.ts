import { describe, expect, it } from 'vitest';
import { buildNFLOpponentContext, parseNFLDefenseGame, type NFLDefenseGame } from './opponentContext';

function defenseGame(index: number, season = 2025): NFLDefenseGame {
  return {
    eventId: `g${index}`,
    date: `2025-${String(index + 1).padStart(2, '0')}-01`,
    season,
    metrics: {
      passingYardsAllowed: 200 + index * 5,
      completionsAllowed: 20 + index,
      passAttemptsAllowed: 30 + index,
      sacksGenerated: 2,
      rushingYardsAllowed: 90 + index * 3,
      rushingAttemptsAllowed: 22 + index,
      yardsPerRushAttemptAllowed: 4.1,
    },
  };
}

describe('NFL prop-specific opponent context', () => {
  const games = Array.from({ length: 10 }, (_, index) => defenseGame(index));

  it('builds Bryce Young passing context from pass yards, completions, attempts and sacks', () => {
    const context = buildNFLOpponentContext({ opponentTeamId: 1, games, market: 'player_pass_yds', position: 'QB', season: 2025 });
    expect(context.status).toBe('PARTIAL');
    expect(context.sampleSize).toBe(10);
    expect(context.availableMetrics).toEqual(['passingYardsAllowed', 'completionsAllowed', 'passAttemptsAllowed', 'sacksGenerated']);
    expect(context.missingFields).toContain('pressure rate');
  });

  it('builds Bijan Robinson rushing context without receiving-position claims', () => {
    const context = buildNFLOpponentContext({ opponentTeamId: 29, games, market: 'player_rush_yds', position: 'RB', season: 2025 });
    expect(context.availableMetrics).toEqual(['rushingYardsAllowed', 'rushingAttemptsAllowed', 'yardsPerRushAttemptAllowed']);
    expect(context.metrics[0].l3.games).toBe(3);
  });

  it('keeps RB receiving splits unavailable when ESPN boxscores do not identify historical position groups', () => {
    const context = buildNFLOpponentContext({ opponentTeamId: 29, games, market: 'player_reception_yds', position: 'RB', season: 2025 });
    expect(context.availableMetrics).toContain('passingYardsAllowed');
    expect(context.missingFields).toContain('receiving yards allowed to running backs');
  });

  it('builds Drake London receiving context from team passing defense only', () => {
    const context = buildNFLOpponentContext({ opponentTeamId: 29, games, market: 'player_receptions', position: 'WR', season: 2025 });
    expect(context.availableMetrics).toContain('completionsAllowed');
    expect(context.missingFields).toContain('targets allowed by position');
  });

  it('parses actual ESPN boxscore field shapes without inventing missing metrics', () => {
    const parsed = parseNFLDefenseGame({ boxscore: {
      teams: [
        { team: { id: '1' }, statistics: [] },
        { team: { id: '27' }, statistics: [
          { name: 'rushingYards', value: 101 }, { name: 'rushingAttempts', value: 23 }, { name: 'yardsPerRushAttempt', value: 4.391 },
        ] },
      ],
      players: [{ team: { id: '27' }, statistics: [{ name: 'passing', labels: ['C/ATT', 'YDS', 'SACKS'], athletes: [{ stats: ['17/32', '167', '1-8'] }] }] }],
    } }, 1, 'event', '2025-09-07', 2025);
    expect(parsed?.metrics).toEqual({ passingYardsAllowed: 167, completionsAllowed: 17, passAttemptsAllowed: 32, sacksGenerated: 1, rushingYardsAllowed: 101, rushingAttemptsAllowed: 23, yardsPerRushAttemptAllowed: 4.391 });
  });

  it('fails closed when the requested defense is absent from the boxscore', () => {
    expect(parseNFLDefenseGame({ boxscore: { teams: [{ team: { id: '1' }, statistics: [] }] } }, 29, 'event', '2025-09-07', 2025)).toBeNull();
  });
});