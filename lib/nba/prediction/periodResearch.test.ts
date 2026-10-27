import { describe, expect, it } from 'vitest';
import { exactNBAQuoteHistory, parseNBAHistoricalPeriodGame, type NBAHistoricalPeriodGame } from './periodResearch';
import type { NBAResearchQuote } from './researchReceipt';

const now = Date.parse('2026-01-21T18:00:00Z');
const quote = { eventId: 'target', tipoff: '2026-01-21T23:00:00Z', homeTeam: 'Home', awayTeam: 'Away', sourceMarket: 'alternate_spreads',
  period: 'FULL_GAME', team: 'Home', player: null, selection: 'Home', line: -5.5 } as NBAResearchQuote;
const game: NBAHistoricalPeriodGame = { gameId: 'prior', startsAt: '2026-01-19T18:00:00Z', observedAt: '2026-01-20T18:00:00Z', completed: true,
  season: 2026, phase: 2, homeTeam: 'Home', awayTeam: 'Other', homeScore: 110, awayScore: 104,
  q1: { homeScore: 24, awayScore: 25, players: [{ id: '1', points: 7, rebounds: 2, assists: 1 }] } };
describe('exact alternate and Q1 historical research', () => {
  it('settles the actual alternate line, never its standard counterpart', () => {
    expect(exactNBAQuoteHistory(quote, [game], undefined, now)).toContain('1 wins, 0 losses');
    expect(exactNBAQuoteHistory({ ...quote, line: -6.5 }, [game], undefined, now)).toContain('0 wins, 1 losses');
    expect(exactNBAQuoteHistory({ ...quote, line: -6 }, [game], undefined, now)).toContain('1 pushes');
  });
  it('uses actual Q1 scores and exact player stats rather than full-game shares', () => {
    expect(exactNBAQuoteHistory({ ...quote, sourceMarket: 'h2h_q1', period: 'Q1', line: null }, [game], undefined, now)).toContain('0 wins, 1 losses');
    for (const [sourceMarket, line] of [['player_points_q1', 6.5], ['player_rebounds_q1', 1.5], ['player_assists_q1', 0.5]] as const) {
      expect(exactNBAQuoteHistory({ ...quote, sourceMarket, period: 'Q1', player: 'Player', selection: 'Over', line }, [game], 1, now)).toContain('1 wins, 0 losses');
    }
    expect(exactNBAQuoteHistory({ ...quote, period: 'Q1' }, [{ ...game, q1: null }], undefined, now)).toContain('unavailable');
  });
  it('does not infer player rebounding or assist counts from scoring plays', () => {
    const parsed = parseNBAHistoricalPeriodGame('prior', { header: { season: { year: 2026, type: 2 }, competitions: [{ date: game.startsAt,
      status: { type: { completed: true } }, competitors: [
        { homeAway: 'home', team: { displayName: 'Home' }, score: '110', linescores: [{ period: 1, value: 24 }] },
        { homeAway: 'away', team: { displayName: 'Away' }, score: '104', linescores: [{ period: 1, value: 25 }] },
      ] }] }, boxscore: { players: [{ statistics: [{ athletes: [{ athlete: { id: '1' } }] }] }] }, plays: [
        { period: { number: 1 }, type: { text: 'End Period' } },
        { period: { number: 1 }, scoringPlay: true, scoreValue: 2, participants: [{ athlete: { id: '1' } }] },
      ] }, game.observedAt);
    expect(parsed?.q1?.players).toEqual([]);
  });
  it('derives Q1 stats from complete explicit scoring, rebound and assist events, not game totals', () => {
    const raw = { header: { season: { year: 2026, type: 2 }, competitions: [{ date: game.startsAt, status: { type: { completed: true } }, competitors: [
      { homeAway: 'home', team: { displayName: 'Home' }, score: '110', linescores: [{ period: 1, value: 2 }] },
      { homeAway: 'away', team: { displayName: 'Away' }, score: '104', linescores: [{ period: 1, value: 0 }] },
    ] }] }, boxscore: { players: [{ statistics: [{ athletes: [
      { athlete: { id: '1', displayName: 'Scorer' } }, { athlete: { id: '2', displayName: 'Helper' } }, { athlete: { id: '3', displayName: 'Absent' } },
    ] }] }] }, plays: [
      { period: { number: 1 }, scoringPlay: true, scoreValue: 2, text: 'Scorer makes layup (Helper assists)', participants: [{ athlete: { id: '1' } }] },
      { period: { number: 1 }, type: { text: 'Defensive Rebound' }, participants: [{ athlete: { id: '2' } }] },
      { period: { number: 2 }, scoringPlay: true, scoreValue: 3, participants: [{ athlete: { id: '1' } }] },
      { period: { number: 1 }, type: { text: 'End Period' } },
    ] };
    const result = parseNBAHistoricalPeriodGame('prior', raw, game.observedAt)!;
    expect(result.q1?.players).toEqual([{ id: '1', points: 2, rebounds: 0, assists: 0 }, { id: '2', points: 0, rebounds: 1, assists: 1 }]);
    expect(exactNBAQuoteHistory({ ...quote, sourceMarket: 'player_assists_q1', period: 'Q1', player: 'Helper', selection: 'Over', line: 0.5 }, [result], 2, now)).toContain('1 wins');
  });
});