import { fixtureGame, fixtureStats } from '../../context/fixtures';
import type { GameModelInput, GameQuote } from './types';

export function historicalFixture(): GameModelInput {
  const predictionAt = '2026-01-21T18:00:00Z';
  const games = Array.from({ length: 20 }, (_, index) => {
    const homeScore = 110 + index % 5;
    const awayScore = 98 + index % 7;
    const game = fixtureGame(index + 1, { homeScore, awayScore, startsAt: `2026-01-${String(index + 1).padStart(2, '0')}T01:00:00Z`,
      completedAt: `2026-01-${String(index + 1).padStart(2, '0')}T03:00:00Z` });
    game.source.fetchedAt = `2026-01-${String(index + 1).padStart(2, '0')}T04:00:00Z`;
    game.source.publishedAt = game.completedAt;
    game.source.updatedAt = game.completedAt;
    game.teams[0].stats = fixtureStats({ points: homeScore, fga: 85 + index % 3, fgm: 40, fta: 20, oreb: 10, turnovers: 12 });
    game.teams[1].stats = fixtureStats({ points: awayScore, fga: 82 + index % 3, fgm: 35, fta: 22, oreb: 9, turnovers: 14 });
    game.plays = [1, 2, 3, 4].map(period => ({ id: `${period}`, sequence: period, period, secondsRemaining: 0, wallclock: game.completedAt,
      type: 'Period end', text: 'Period end', teamId: null, participantIds: [], homeScore, awayScore }));
    return game;
  });
  const target = fixtureGame(21, { gameId: 'target', completed: false, completedAt: null, startsAt: '2026-01-21T23:00:00Z', homeScore: null, awayScore: null });
  target.source.fetchedAt = predictionAt;
  return { predictionAt, snapshot: { target, asOf: predictionAt, games, calendar: [...games, target], injuries: [],
    injuryFeed: { state: 'UNAVAILABLE', source: null }, news: [], missing: [] } };
}

export const binding = { sourceGameId: 'target', eventId: 'odds-1', homeTeam: 'Home', awayTeam: 'Away' };
export function quote(overrides: Partial<GameQuote> = {}): GameQuote {
  return { provider: 'THE_ODDS_API', eventId: 'odds-1', homeTeam: 'Home', awayTeam: 'Away', commenceTime: '2026-01-21T23:00:00Z', sportsbookKey: 'fixture',
    sportsbook: 'Fixture Book', market: 'TOTAL', selection: 'OVER', team: null, line: 210.5, americanOdds: -110,
    updatedAt: '2026-01-21T17:30:00Z', observedAt: '2026-01-21T17:31:00Z', period: 'FULL_GAME', ...overrides };
}