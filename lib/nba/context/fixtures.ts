import type { BuildEnvironment, ContextGame, ContextStats, NBAContextSnapshot, PlayerObservation, SourceReference } from './types';

export const fixtureSource = (id = 'fixture'): SourceReference => ({ id, provider: 'ESPN', url: `https://site.api.espn.com/fixture/${id}`, recordId: id, publishedAt: '2026-01-20T12:00:00.000Z', updatedAt: '2026-01-20T12:00:00.000Z', fetchedAt: '2026-01-20T12:00:00.000Z', freshness: 'FRESH' });
export const fixtureStats = (overrides: Partial<ContextStats> = {}): ContextStats => ({ minutes: 30, points: 20, rebounds: 5, assists: 4, steals: 1, blocks: 0, turnovers: 2, fgm: 7, fga: 15, tpm: 2, tpa: 6, ftm: 4, fta: 5, oreb: 1, dreb: 4, fouls: 2, ...overrides });
export const fixturePlayer = (playerId = 10, overrides: Partial<PlayerObservation> = {}): PlayerObservation => ({ playerId, name: `Player ${playerId}`, starter: true, didNotPlay: false, active: true, dnpReason: null, ejected: false, stats: fixtureStats(), ...overrides });
export function fixtureGame(index: number, overrides: Partial<ContextGame> = {}): ContextGame {
  const day = String(index).padStart(2, '0');
  return { gameId: `game-${index}`, seasonId: '2026', phase: 'REGULAR', startsAt: `2026-01-${day}T20:00:00.000Z`, completed: true, completedAt: `2026-01-${day}T22:30:00.000Z`, homeTeamId: 1, awayTeamId: 2, homeScore: 100, awayScore: 90, venueId: 'arena-1', venueName: 'Fixture Arena', neutralSite: false, round: null, seriesEventIds: [], plays: [], source: fixtureSource(`game-${index}`), teams: [{ teamId: 1, players: [fixturePlayer(), fixturePlayer(11)], stats: fixtureStats({ minutes: 240, fga: 80, fgm: 35, tpa: 30, tpm: 10, turnovers: 12, oreb: 8 }), paintPoints: 40, rosterComplete: true }, { teamId: 2, players: [], stats: fixtureStats({ minutes: 240, fga: 85, fgm: 32, tpa: 35, tpm: 9, turnovers: 15, oreb: 10 }), paintPoints: 32, rosterComplete: true }], ...overrides };
}
export function fixtureEnvironment(games = [fixtureGame(1), fixtureGame(2)]): BuildEnvironment {
  const target = fixtureGame(21, { completed: false, completedAt: null, teams: [], plays: [] });
  const snapshot: NBAContextSnapshot = { target, asOf: '2026-01-20T18:00:00.000Z', games, calendar: [...games, target], injuries: [], injuryFeed: { state: 'AVAILABLE', source: fixtureSource('injuries') }, news: [], missing: [] };
  return { request: { playerId: 10, teamId: 1, gameId: target.gameId, asOf: snapshot.asOf }, snapshot, cutoff: snapshot.asOf, games, teamGames: games, evidence: [] };
}