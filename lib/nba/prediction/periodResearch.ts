import { espnNBASiteFetch } from '../client';
import type { NBAResearchQuote } from './researchReceipt';

export interface NBAHistoricalPeriodGame {
  gameId: string; startsAt: string; observedAt: string; completed: boolean; season: number; phase: number;
  homeTeam: string; awayTeam: string; homeScore: number; awayScore: number;
  q1: { homeScore: number; awayScore: number; players: Array<{ id: string; points: number | null; rebounds: number | null; assists: number | null }> } | null;
}

export function exactNBAQuoteHistory(quote: NBAResearchQuote, games: NBAHistoricalPeriodGame[], playerId?: number, now = Date.now()): string {
  const cutoff = Math.min(now, Date.parse(quote.tipoff));
  const eligible = games.filter(game => game.completed && game.gameId !== quote.eventId
    && Date.parse(game.startsAt) + 6 * 3600000 < cutoff && Date.parse(game.observedAt) <= now
    && Number.isFinite(game.season) && [2, 3].includes(game.phase)
    && [game.homeTeam, game.awayTeam].includes(quote.player ? quote.team ?? '' : quote.team ?? quote.homeTeam));
  const latest = [...eligible].sort((first, second) => Date.parse(second.startsAt) - Date.parse(first.startsAt))[0];
  let missing = 0;
  const values = eligible.filter(game => game.season === latest?.season && game.phase === latest?.phase)
    .sort((first, second) => Date.parse(second.startsAt) - Date.parse(first.startsAt)).slice(0, 20).flatMap(game => {
      const period = quote.period === 'Q1' ? game.q1 : { homeScore: game.homeScore, awayScore: game.awayScore };
      if (!period) { missing += 1; return []; }
      if (quote.player) {
        const player = game.q1?.players.find(entry => entry.id === String(playerId));
        const value = quote.sourceMarket === 'player_points_q1' ? player?.points
          : quote.sourceMarket === 'player_rebounds_q1' ? player?.rebounds : player?.assists;
        if (value == null || !Number.isFinite(value)) { missing += 1; return []; }
        return [value];
      }
      const home = game.homeTeam === (quote.team ?? quote.homeTeam);
      const own = home ? period.homeScore : period.awayScore;
      const other = home ? period.awayScore : period.homeScore;
      if (![own, other].every(value => Number.isFinite(value) && value >= 0)) { missing += 1; return []; }
      return [quote.sourceMarket.includes('team_totals') ? own : quote.sourceMarket.includes('totals') ? own + other : own - other];
    });
  if (!values.length) return `Historical research unavailable: no eligible exact ${quote.period} ${quote.player ? 'player' : 'team'} data. No full-game or standard-line substitute used.`;
  const moneyline = quote.sourceMarket.startsWith('h2h');
  const threshold = moneyline ? 0 : quote.line!;
  const wins = values.filter(value => moneyline ? value > 0 : quote.sourceMarket.includes('spreads') ? value + threshold > 0
    : quote.selection === 'Over' ? value > threshold : value < threshold).length;
  const pushes = values.filter(value => quote.sourceMarket.includes('spreads') ? value + threshold === 0 : value === threshold).length;
  return `Descriptive exact-line ${quote.period} research: ${values.length} completed games, season ${latest.season}, phase ${latest.phase}; ${wins} wins, ${values.length - wins - pushes} losses, ${pushes} pushes at quoted ${quote.selection} ${quote.line ?? 'moneyline'}. ${missing} games missing exact period/player data excluded. Historical counts are not probability, EV or qualification.`;
}

interface RawSummary {
  header?: { season?: { year?: number; type?: number }; competitions?: Array<{ date: string; status?: { type?: { completed?: boolean } };
    competitors?: Array<{ homeAway: string; score?: string; team?: { displayName?: string }; linescores?: Array<{ period: number; value: number }> }> }> };
  boxscore?: { players?: Array<{ statistics?: Array<{ athletes?: Array<{ didNotPlay?: boolean; athlete?: { id?: string; displayName?: string; fullName?: string } }> }> }> };
  plays?: Array<{ period?: { number?: number }; type?: { id?: string; text?: string }; scoringPlay?: boolean; scoreValue?: number;
    participants?: Array<{ athlete?: { id?: string }; type?: string }>; text?: string }>;
}

export function parseNBAHistoricalPeriodGame(gameId: string, raw: RawSummary, observedAt: string): NBAHistoricalPeriodGame | null {
  const game = raw.header?.competitions?.[0];
  const home = game?.competitors?.find(team => team.homeAway === 'home');
  const away = game?.competitors?.find(team => team.homeAway === 'away');
  if (!game || !home?.team?.displayName || !away?.team?.displayName || !game.status?.type?.completed
    || !raw.header?.season?.year || !raw.header.season.type) return null;
  const qHome = home.linescores?.find(period => period.period === 1)?.value;
  const qAway = away.linescores?.find(period => period.period === 1)?.value;
  const plays = raw.plays?.filter(play => play.period?.number === 1) ?? [];
  const scoring = plays.filter(play => play.scoringPlay === true);
  const complete = plays.some(play => /end.*(?:1st|first|1).*quarter|end.*period/i.test(`${play.type?.text ?? ''} ${play.text ?? ''}`))
    && qHome != null && qAway != null && scoring.every(play => Number.isInteger(play.scoreValue) && play.scoreValue! > 0)
    && scoring.reduce((total, play) => total + play.scoreValue!, 0) === qHome + qAway;
  const roster = [...new Map((raw.boxscore?.players ?? []).flatMap(team => team.statistics ?? []).flatMap(group => group.athletes ?? [])
    .filter(entry => entry.athlete?.id).map(entry => [entry.athlete!.id!, entry])).values()];
  const scoringAttributed = scoring.every(play => roster.some(entry => entry.athlete?.id === play.participants?.[0]?.athlete?.id));
  const identity = (name: string) => roster.filter(entry => [entry.athlete?.displayName, entry.athlete?.fullName].includes(name));
  const assists = new Map<string, number>();
  let assistsComplete = complete && plays.some(play => /assists?/i.test(play.text ?? '') || play.participants?.some(participant => /assist/i.test(participant.type ?? '')));
  let reboundsComplete = complete && plays.some(play => /rebound/i.test(`${play.type?.text ?? ''} ${play.text ?? ''}`));
  const rebounds = new Map<string, number>();
  for (const play of plays) {
    const text = `${play.type?.text ?? ''} ${play.text ?? ''}`;
    if (/rebound/i.test(text)) {
      const participant = play.participants?.[0]?.athlete?.id;
      if (participant && roster.some(entry => entry.athlete?.id === participant)) rebounds.set(participant, (rebounds.get(participant) ?? 0) + 1);
      else if (!/team rebound/i.test(text)) reboundsComplete = false;
    }
    const named = play.text?.match(/\(([^()]+) assists?\)/i)?.[1];
    const explicit = play.participants?.filter(participant => /assist/i.test(participant.type ?? '')) ?? [];
    const namedMatches = named ? identity(named) : [];
    const assister = explicit.length === 1 ? explicit[0].athlete?.id : namedMatches.length === 1 ? namedMatches[0].athlete?.id : null;
    if (named || explicit.length) {
      if (assister) assists.set(assister, (assists.get(assister) ?? 0) + 1);
      else assistsComplete = false;
    }
  }
  const players = complete && scoringAttributed ? roster.flatMap(entry => {
    const id = entry.athlete?.id;
    if (!id || entry.didNotPlay === true) return [];
    const attributed = plays.filter(play => play.participants?.[0]?.athlete?.id === id);
    const participated = attributed.length > 0 || assists.has(id) || rebounds.has(id);
    if (!participated) return [];
    const points = attributed.filter(play => play.scoringPlay === true).reduce((sum, play) => sum + (play.scoreValue ?? NaN), 0);
    return [{ id, points: Number.isFinite(points) ? points : null,
      rebounds: reboundsComplete ? rebounds.get(id) ?? 0 : null, assists: assistsComplete ? assists.get(id) ?? 0 : null }];
  }) : [];
  return { gameId, startsAt: game.date, observedAt, completed: true, season: raw.header.season.year, phase: raw.header.season.type,
    homeTeam: home.team.displayName, awayTeam: away.team.displayName, homeScore: Number(home.score), awayScore: Number(away.score),
    q1: qHome != null && qAway != null ? { homeScore: qHome, awayScore: qAway, players } : null };
}

export async function loadNBAHistoricalPeriods(gameIds: string[]): Promise<NBAHistoricalPeriodGame[]> {
  return (await Promise.all([...new Set(gameIds)].map(async id => {
    const raw = await espnNBASiteFetch<RawSummary>('summary', { event: id }, 3600).catch(() => null);
    return raw ? parseNBAHistoricalPeriodGame(id, raw, new Date().toISOString()) : null;
  }))).filter((game): game is NBAHistoricalPeriodGame => game != null);
}