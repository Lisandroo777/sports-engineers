import { iso } from './evidence';
import type { AvailabilityStatus, ContextGame, ContextStats, InjuryObservation, NewsObservation, Phase, PlayerObservation, SourceReference, TeamObservation } from './types';

export const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const numeric = (value: unknown): number | null => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) ? Number(value) : null;
const flag = (value: unknown): boolean | null => typeof value === 'boolean' ? value : null;
const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value.trim() : null;

export function parseMinutes(value: unknown): number | null {
  if (typeof value === 'string' && value.includes(':')) {
    const match = value.match(/^(\d+):(\d{2})$/);
    return match && Number(match[2]) < 60 ? Number(match[1]) + Number(match[2]) / 60 : null;
  }
  const parsed = numeric(value);
  return parsed != null && parsed >= 0 ? parsed : null;
}

export function parseShooting(value: unknown): [number | null, number | null] {
  const match = typeof value === 'string' ? value.trim().match(/^(\d+)\s*-\s*(\d+)$/) : null;
  return match && Number(match[1]) <= Number(match[2]) ? [Number(match[1]), Number(match[2])] : [null, null];
}

export function normalizeStats(names: string[], values: unknown[]): ContextStats {
  const raw = Object.fromEntries(names.map((name, index) => [name, values[index]]));
  const find = (...keys: string[]) => keys.map(key => raw[key]).find(value => value != null);
  const nonnegative = (value: unknown) => { const parsed = numeric(value); return parsed != null && parsed >= 0 ? parsed : null; };
  const [fgm, fga] = parseShooting(find('fieldGoalsMade-fieldGoalsAttempted', 'FG'));
  const [tpm, tpa] = parseShooting(find('threePointFieldGoalsMade-threePointFieldGoalsAttempted', '3PT'));
  const [ftm, fta] = parseShooting(find('freeThrowsMade-freeThrowsAttempted', 'FT'));
  return {
    minutes: parseMinutes(find('minutes', 'MIN')), points: nonnegative(find('points', 'PTS')),
    rebounds: nonnegative(find('totalRebounds', 'rebounds', 'REB')), assists: nonnegative(find('assists', 'AST')),
    steals: nonnegative(find('steals', 'STL')), blocks: nonnegative(find('blocks', 'BLK')),
    turnovers: nonnegative(find('totalTurnovers', 'turnovers', 'TO')), fgm, fga, tpm, tpa, ftm, fta,
    oreb: nonnegative(find('offensiveRebounds', 'OREB')), dreb: nonnegative(find('defensiveRebounds', 'DREB')), fouls: nonnegative(find('fouls', 'PF')),
  };
}

export function officialPhase(value: unknown): Phase {
  const season = record(value);
  const code = numeric(season.type ?? season.id ?? value);
  const slug = text(season.slug)?.toLowerCase();
  if (code === 1 || slug === 'pre-season') return 'PRESEASON';
  if (code === 2 || slug === 'regular-season') return 'REGULAR';
  if (code === 3 || slug === 'post-season') return 'POSTSEASON';
  return 'UNKNOWN';
}

function roundName(competition: Record<string, unknown>): string | null {
  const metadata = [text(record(competition.type).abbreviation), ...list(competition.notes).map(note => text(record(note).headline)),
    ...list(competition.series).map(series => text(record(series).description))].filter(Boolean).join(' ');
  if (/play.?in/i.test(metadata)) return 'Play-In';
  if (/conference finals/i.test(metadata)) return 'Conference Finals';
  if (/conference semi|second round/i.test(metadata)) return 'Conference Semifinals';
  if (/first round/i.test(metadata)) return 'First Round';
  if (/nba finals|\bFINAL\b/i.test(metadata)) return 'NBA Finals';
  return null;
}

export function normalizeScheduleEvent(value: unknown, source: SourceReference): ContextGame | null {
  const event = record(value);
  const competition = record(list(event.competitions)[0]);
  const teams = list(competition.competitors).map(record);
  const home = teams.find(team => team.homeAway === 'home');
  const away = teams.find(team => team.homeAway === 'away');
  const gameId = text(event.id);
  const startsAt = iso(event.date ?? competition.date);
  const homeTeamId = numeric(record(home?.team).id ?? home?.id);
  const awayTeamId = numeric(record(away?.team).id ?? away?.id);
  if (!gameId || !startsAt || !homeTeamId || !awayTeamId || homeTeamId === awayTeamId) return null;
  const season = record(event.season);
  const year = numeric(season.year);
  const series = list(competition.series).length ? list(competition.series) : [competition.series];
  const playoff = series.map(record).find(entry => entry.type === 'playoff');
  return {
    gameId, startsAt, seasonId: year != null ? String(year) : null,
    phase: officialPhase(event.seasonType ?? event.season), completed: record(record(competition.status).type).completed === true,
    completedAt: iso(competition.completedAt), homeTeamId, awayTeamId,
    homeScore: numeric(home?.score), awayScore: numeric(away?.score),
    venueId: text(record(competition.venue).id), venueName: text(record(competition.venue).fullName),
    neutralSite: flag(competition.neutralSite), round: roundName(competition),
    seriesEventIds: list(playoff?.events).map(entry => text(record(entry).id)).filter((id): id is string => id != null),
    teams: [], plays: [], source,
  };
}

export function normalizeSummary(payload: unknown, source: SourceReference): ContextGame | null {
  const data = record(payload);
  const header = record(data.header);
  const game = normalizeScheduleEvent({ ...header, date: record(list(header.competitions)[0]).date }, source);
  if (!game) return null;
  game.plays = list(data.plays).flatMap(value => {
    const play = record(value);
    const id = text(play.id);
    if (!id) return [];
    const clock = parseMinutes(record(play.clock).displayValue);
    return [{ id, sequence: numeric(play.sequenceNumber) ?? Number.NaN, period: numeric(record(play.period).number),
      secondsRemaining: clock != null ? clock * 60 : null, wallclock: iso(play.wallclock), type: text(record(play.type).text) ?? 'UNKNOWN',
      text: text(play.text) ?? '', teamId: numeric(record(play.team).id),
      participantIds: list(play.participants).map(entry => numeric(record(record(entry).athlete).id)).filter((id): id is number => id != null),
      homeScore: numeric(play.homeScore), awayScore: numeric(play.awayScore) }];
  });
  const competition = record(list(header.competitions)[0]);
  const finalPeriod = Math.max(4, numeric(record(competition.status).period) ?? 0, ...game.plays.map(play => play.period ?? 0));
  const endings = game.plays.filter(play => play.period === finalPeriod && play.secondsRemaining === 0 && /end.*(game|quarter|period)|game.*end/i.test(`${play.type} ${play.text}`)
    && play.wallclock != null && play.homeScore === game.homeScore && play.awayScore === game.awayScore);
  game.completedAt = game.completed ? endings.map(play => play.wallclock!).sort().at(-1) ?? game.completedAt : null;
  const box = record(data.boxscore);
  const totals = list(box.teams).map(record);
  game.teams = list(box.players).flatMap(value => {
    const team = record(value);
    const teamId = numeric(record(team.team).id);
    if (teamId !== game.homeTeamId && teamId !== game.awayTeamId) return [];
    const players: PlayerObservation[] = list(team.statistics).flatMap(value => {
      const group = record(value);
      const names = list(group.keys ?? group.names).map(String);
      return list(group.athletes).flatMap(value => {
        const row = record(value);
        const athlete = record(row.athlete);
        const playerId = numeric(athlete.id);
        if (!playerId) return [];
        const didNotPlay = flag(row.didNotPlay);
        return [{ playerId, name: text(athlete.displayName ?? athlete.fullName) ?? String(playerId),
          starter: flag(row.starter), active: flag(row.active), didNotPlay,
          dnpReason: didNotPlay === true ? text(row.reason) : null, ejected: flag(row.ejected),
          stats: normalizeStats(names, didNotPlay === true ? [] : list(row.stats)) }];
      });
    });
    const total = totals.find(entry => numeric(record(entry.team).id) === teamId);
    const stats = list(total?.statistics).map(record);
    return [{ teamId: teamId!, players: [...new Map(players.map(player => [player.playerId, player])).values()],
      stats: normalizeStats(stats.map(stat => String(stat.name)), stats.map(stat => stat.displayValue ?? stat.value)),
      paintPoints: numeric(stats.find(stat => stat.name === 'pointsInPaint')?.displayValue),
      rosterComplete: players.length >= 5 && players.filter(player => player.starter === true).length === 5 && players.every(player => player.didNotPlay != null),
      participationCoverage: { rows: players.length, known: players.filter(player => player.didNotPlay != null).length, starters: players.filter(player => player.starter === true).length } } satisfies TeamObservation];
  });
  return game;
}

export function normalizeStatus(value: unknown): AvailabilityStatus {
  const status = text(value)?.toLowerCase();
  if (!status) return 'UNKNOWN';
  if (/^(out|out for (the )?season|injured reserve)$/.test(status)) return 'OUT';
  if (status === 'doubtful') return 'DOUBTFUL';
  if (status === 'questionable') return 'QUESTIONABLE';
  if (status === 'probable') return 'PROBABLE';
  if (/^(active|available)$/.test(status)) return 'AVAILABLE';
  return 'UNKNOWN';
}

export function normalizeInjuries(payload: unknown, source: SourceReference): InjuryObservation[] {
  return list(record(payload).injuries).flatMap(value => {
    const team = record(value);
    return list(team.injuries).map(value => {
      const injury = record(value);
      const athlete = record(injury.athlete ?? injury.player);
      const hrefs = list(athlete.links).map(link => text(record(link).href)).filter(Boolean).join(' ');
      const linkedId = hrefs.match(/\/id\/(\d+)(?:\/|\b)/)?.[1];
      return { playerId: numeric(athlete.id ?? linkedId), teamId: numeric(record(injury.team).id ?? team.id),
        status: normalizeStatus(injury.status), rawStatus: text(injury.status) ?? 'UNKNOWN',
        comment: text(injury.longComment ?? injury.shortComment),
        source: { ...source, id: `${source.id}:${athlete.id ?? linkedId ?? 'unknown'}`, recordId: text(injury.id), publishedAt: iso(injury.date), updatedAt: iso(injury.date) } };
    });
  });
}

export function normalizeNews(payload: unknown, source: SourceReference): NewsObservation[] {
  const data = record(payload);
  return list(record(data.news).articles).flatMap(value => {
    const article = record(value);
    const id = text(article.id);
    const headline = text(article.headline);
    if (!id || !headline) return [];
    const categories = list(article.categories).map(record);
    const playerIds = categories.flatMap(category => { const id = numeric(record(category.athlete).id); return id ? [id] : []; });
    const teamIds = categories.flatMap(category => { const id = numeric(record(category.team).id); return id ? [id] : []; });
    return [{ id, headline, text: text(article.description), playerIds, teamIds,
      source: { ...source, id: `news:${id}`, recordId: id, url: text(record(record(article.links).web).href) ?? source.url,
        publishedAt: iso(article.published), updatedAt: iso(article.lastModified) } }];
  });
}