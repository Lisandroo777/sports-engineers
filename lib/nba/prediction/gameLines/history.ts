import type { ContextGame, ContextStats } from '../../context/types';
import { basketballDate } from '../../context/schedule';
import type { GamePhase, GameModelInput, TeamProfile, TeamSample } from './types';

export function phaseOf(game: ContextGame): GamePhase {
  if (game.phase === 'POSTSEASON' && game.round && /play.?in/i.test(game.round)) return 'PLAY_IN';
  return game.phase;
}

function possessions(stats: ContextStats): number | null {
  const { fga, fta, oreb, turnovers } = stats;
  if ([fga, fta, oreb, turnovers].some(value => value == null || !Number.isFinite(value) || value < 0)) return null;
  if (stats.fgm == null || stats.fgm < 0 || stats.fgm > fga! || oreb! > fga!) return null;
  const proxy = fga! + 0.44 * fta! - oreb! + turnovers!;
  return proxy > 0 ? proxy : null;
}

export function selectTeamGames(input: GameModelInput) {
  const { target } = input.snapshot;
  const cutoff = Date.parse(input.predictionAt);
  const unique = new Map<string, ContextGame>();
  const conflicts = new Set<string>();
  const exclusions: Array<{ gameId: string; reason: string }> = [];
  for (const game of input.snapshot.games) {
    if (unique.has(game.gameId) && JSON.stringify(unique.get(game.gameId)) !== JSON.stringify(game)) conflicts.add(game.gameId);
    else unique.set(game.gameId, game);
  }
  const games = [...unique.values()].filter(game => {
    const stamp = Date.parse(game.source.fetchedAt);
    const end = game.completedAt ? Date.parse(game.completedAt) : NaN;
    const start = Date.parse(game.startsAt);
    let reason: string | null = null;
    if (conflicts.has(game.gameId)) reason = 'Conflicting duplicate snapshots';
    else if (game.gameId === target.gameId) reason = 'Target game excluded';
    else if (!game.completed || !Number.isFinite(end) || !Number.isFinite(start) || end <= start || end >= cutoff || !Number.isFinite(stamp)
      || stamp < end || stamp > cutoff || game.source.updatedAt != null && (!Number.isFinite(Date.parse(game.source.updatedAt)) || Date.parse(game.source.updatedAt) > stamp)
      || game.source.publishedAt != null && (!Number.isFinite(Date.parse(game.source.publishedAt)) || Date.parse(game.source.publishedAt) > stamp)) reason = 'Finality, completion or source observation not known before prediction';
    else if (game.seasonId !== target.seasonId || phaseOf(game) !== phaseOf(target)) reason = 'Different or unknown season/phase';
    if (reason) exclusions.push({ gameId: game.gameId, reason });
    return reason == null;
  }).sort((first, second) => Date.parse(first.startsAt) - Date.parse(second.startsAt));
  return { games, exclusions };
}

export function teamSamples(games: ContextGame[], teamId: number): TeamSample[] {
  return games.flatMap(game => {
    if (![game.homeTeamId, game.awayTeamId].includes(teamId) || game.homeTeamId === game.awayTeamId) return [];
    const own = game.teams.find(team => team.teamId === teamId);
    const other = game.teams.find(team => team.teamId === (game.homeTeamId === teamId ? game.awayTeamId : game.homeTeamId));
    if (!own || !other || game.homeScore == null || game.awayScore == null || game.homeScore === game.awayScore
      || ![game.homeScore, game.awayScore].every(score => Number.isInteger(score) && score >= 0)) return [];
    const periods = new Set(game.plays.filter(play => play.secondsRemaining === 0 && /end/i.test(`${play.type} ${play.text}`)).map(play => play.period));
    if (![1, 2, 3, 4].every(period => periods.has(period)) || game.plays.some(play => (play.period ?? 0) > 4)) return [];
    const finalPlay = game.plays.find(play => play.period === 4 && play.secondsRemaining === 0 && /end/i.test(`${play.type} ${play.text}`)
      && play.homeScore === game.homeScore && play.awayScore === game.awayScore && play.wallclock != null
      && Date.parse(play.wallclock) === Date.parse(game.completedAt!));
    if (!finalPlay) return [];
    const ownPossessions = possessions(own.stats);
    const otherPossessions = possessions(other.stats);
    if (ownPossessions == null || otherPossessions == null) return [];
    const home = game.homeTeamId === teamId;
    const scored = home ? game.homeScore : game.awayScore;
    const allowed = home ? game.awayScore : game.homeScore;
    if (own.stats.points !== scored || other.stats.points !== allowed) return [];
    const proxy = (ownPossessions + otherPossessions) / 2;
    return [{ gameId: game.gameId, startsAt: game.startsAt, home, scored, allowed, possessions: proxy,
      offensiveEfficiency: 100 * scored / proxy, defensiveEfficiency: 100 * allowed / proxy }];
  });
}

export const average = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

export function teamProfile(input: GameModelInput, teamId: number, rows: TeamSample[], home: boolean): TeamProfile {
  const target = input.snapshot.target;
  const recent = rows.slice(-5);
  const venue = target.neutralSite === false ? rows.filter(row => row.home === home) : [];
  const blend = (key: 'offensiveEfficiency' | 'defensiveEfficiency' | 'possessions') => {
    const baseline = average(rows.map(row => row[key]));
    const form = 0.75 * baseline + 0.25 * average(recent.map(row => row[key]));
    const shrink = venue.length / (venue.length + 10);
    return venue.length ? form * (1 - shrink) + average(venue.map(row => row[key])) * shrink : form;
  };
  const prior = input.snapshot.calendar.filter(game => game.gameId !== target.gameId && [game.homeTeamId, game.awayTeamId].includes(teamId)
    && game.seasonId === target.seasonId && Number.isFinite(Date.parse(game.startsAt)) && Date.parse(game.startsAt) < Date.parse(target.startsAt)
    && Number.isFinite(Date.parse(game.source.fetchedAt)) && Date.parse(game.source.fetchedAt) <= Date.parse(input.predictionAt))
    .sort((first, second) => Date.parse(first.startsAt) - Date.parse(second.startsAt)).at(-1);
  const days = prior ? (Date.parse(`${basketballDate(target.startsAt)}T12:00:00Z`) - Date.parse(`${basketballDate(prior.startsAt)}T12:00:00Z`)) / 86400000 : null;
  return { teamId, sampleSize: rows.length, gameIds: rows.map(row => row.gameId), offense: blend('offensiveEfficiency'), defense: blend('defensiveEfficiency'),
    pace: blend('possessions'), seasonScored: average(rows.map(row => row.scored)), recentScored: average(recent.map(row => row.scored)), venueSampleSize: venue.length,
    scheduledRestDays: days == null ? null : Math.max(0, days - 1), backToBack: days == null ? null : days === 1,
    restCoverage: prior ? 'PARTIAL' : 'UNAVAILABLE', priorVenueId: prior?.venueId ?? null,
    venueChanged: prior?.venueId && target.venueId ? prior.venueId !== target.venueId : null };
}