import { getMLBApiBaseUrl, mlbFetch } from './client';
import type { MLBGame } from './types';

export type MLBContextEvidence<T> = {
  status: 'AVAILABLE'; value: T; source: string; retrievedAt: string; sourceTimestamp: string | null; dataQualityNote: string;
} | {
  status: 'UNAVAILABLE'; value: null; source: string | null; retrievedAt: string; sourceTimestamp: string | null; dataQualityNote: string;
};

type Person = { id: number; fullName: string };
type PlayerStatus = { code?: string; description?: string };
type InjuryStatus = { playerId: number; name: string; code: string | null; description: string | null; explicitlyInjured: boolean | null };
type FeedPlayer = Partial<Person> & { status?: PlayerStatus; injured?: boolean };
type BoxPlayer = { person?: Person; status?: PlayerStatus; injured?: boolean };
type BoxTeam = { battingOrder?: number[]; players?: Record<string, BoxPlayer> };

export function isMLBGameFinished(game: { status: string }): boolean {
  return /final|game over|completed|postponed|cancell?ed|suspended/i.test(game.status);
}

export function hasMLBGameStarted(game: { status: string; gameTime?: string | null }, now = Date.now()): boolean {
  if (/in progress|live|manager challenge|review/i.test(game.status)) return true;
  const start = Date.parse(game.gameTime ?? '');
  return Number.isFinite(start) && start <= now && !/^(?:scheduled|pre-game|warmup|delayed start)/i.test(game.status);
}

export function isMLBGameEligibleForResearch(game: { status: string; gameTime?: string | null }, now = Date.now()): boolean {
  return !isMLBGameFinished(game) && !hasMLBGameStarted(game, now);
}

export interface MLBResearchFeed {
  gamePk?: number;
  metaData?: { timeStamp?: string };
  gameData?: {
    game?: { type?: string };
    status?: { abstractGameState?: string; detailedState?: string; codedGameState?: string };
    probablePitchers?: { home?: Person; away?: Person };
    players?: Record<string, FeedPlayer>;
    weather?: { condition?: string; temp?: string; wind?: string };
    venue?: { id?: number; name?: string; fieldInfo?: { roofType?: string }; location?: { defaultCoordinates?: { latitude?: number; longitude?: number } } };
  };
  liveData?: { boxscore?: { teams?: { home?: BoxTeam; away?: BoxTeam } } };
}

export interface MLBResearchContext {
  gameId: string;
  retrievedAt: string;
  sourceTimestamp: string | null;
  sources: string[];
  dataQualityNote: string;
  gameStatus: MLBContextEvidence<{ gameType: string | null; abstractState: string | null; detailedState: string | null; code: string | null }>;
  probablePitchers: { home: MLBContextEvidence<Person>; away: MLBContextEvidence<Person> };
  confirmedLineups: { home: MLBContextEvidence<Array<Person & { battingOrder: number }>>; away: MLBContextEvidence<Array<Person & { battingOrder: number }>> };
  weather: MLBContextEvidence<{ kind: 'OBSERVED'; condition: string | null; temperatureF: string | null; wind: string | null }>;
  venue: MLBContextEvidence<{ id: number | null; name: string | null; roofType: string | null; latitude: number | null; longitude: number | null }>;
  playerInjuries: MLBContextEvidence<InjuryStatus[]>;
  bullpenWorkload: MLBContextEvidence<never>;
  history?: {
    regularSeasonGames: number;
    postseasonGames: number;
    postseasonRecent?: Array<{ date: string; gamePk?: number; gameType?: string; value: number | null }>;
    qualityNotes: string[];
  };
  player?: {
    teamMembership: MLBContextEvidence<{ currentTeamId: number; scheduledTeamIds: number[]; matchesScheduledTeam: boolean }>;
    scheduledStarter: MLBContextEvidence<{ playerId: number; isListedProbableStarter: boolean }>;
  };
}

export async function getMLBResearchContext(gameId: string): Promise<MLBResearchContext> {
  const path = `../v1.1/game/${encodeURIComponent(gameId)}/feed/live`;
  const url = new URL(path, `${getMLBApiBaseUrl()}/`).toString();
  let feed: MLBResearchFeed | null = null;
  try {
    const payload = await mlbFetch<MLBResearchFeed>(path, { revalidate: 60 });
    if (payload.gamePk != null && String(payload.gamePk) !== gameId) throw new Error('Game identity mismatch');
    feed = payload;
  } catch { feed = null; }
  const retrievedAt = new Date().toISOString();
  const sourceTimestamp = feed?.metaData?.timeStamp ?? null;
  const unavailable = <T>(dataQualityNote: string): MLBContextEvidence<T> => ({ status: 'UNAVAILABLE', value: null, source: feed ? url : null, retrievedAt, sourceTimestamp, dataQualityNote });
  const available = <T>(value: T, dataQualityNote: string): MLBContextEvidence<T> => ({ status: 'AVAILABLE', value, source: url, retrievedAt, sourceTimestamp, dataQualityNote });
  const data = feed?.gameData;
  const boxTeams = feed?.liveData?.boxscore?.teams;
  const lineup = (side: 'home' | 'away'): MLBResearchContext['confirmedLineups']['home'] => {
    const team = boxTeams?.[side];
    const order = team?.battingOrder;
    if (!order || order.length !== 9 || new Set(order).size !== 9) return unavailable('No complete explicit battingOrder supplied; no projected lineup inferred.');
    const players = order.map((id, index) => {
      const person = team?.players?.[`ID${id}`]?.person ?? data?.players?.[`ID${id}`];
      return person?.id === id && person.fullName ? { id, fullName: person.fullName, battingOrder: index + 1 } : null;
    });
    if (players.some(player => !player)) return unavailable('Explicit batting order lacks player identities; no lineup inferred.');
    return available(players.filter(player => player !== null), 'Explicit feed battingOrder and player identities only; not a projected lineup or guarantee of future participation.');
  };
  const probable = (side: 'home' | 'away'): MLBContextEvidence<Person> => {
    const pitcher = data?.probablePitchers?.[side];
    return pitcher?.id && pitcher.fullName ? available(pitcher, 'Probable starter as listed by MLB; not a confirmed start.') : unavailable('No probable starter supplied.');
  };
  const identities = new Map<number, FeedPlayer>();
  for (const player of Object.values(data?.players ?? {})) if (player.id) identities.set(player.id, player);
  for (const team of [boxTeams?.home, boxTeams?.away]) {
    for (const player of Object.values(team?.players ?? {})) {
      if (player.person?.id) identities.set(player.person.id, { ...identities.get(player.person.id), ...player.person, ...(player.status ? { status: player.status } : {}), ...(typeof player.injured === 'boolean' ? { injured: player.injured } : {}) });
    }
  }
  const injuries: InjuryStatus[] = [];
  for (const [id, player] of identities) {
    const status = player.status;
    if (!status?.code && !status?.description && typeof player.injured !== 'boolean') continue;
    const injuryListed = /injur|disabled/i.test(status?.description ?? '') || /^(?:D10|D15|D60|IL|IL10|IL15|IL60)$/.test(status?.code ?? '');
    injuries.push({ playerId: id, name: player.fullName ?? String(id), code: status?.code ?? null, description: status?.description ?? null, explicitlyInjured: typeof player.injured === 'boolean' ? player.injured : injuryListed ? true : null });
  }
  const weather = data?.weather;
  const venue = data?.venue;
  const coordinates = venue?.location?.defaultCoordinates;
  const status = data?.status;
  return {
    gameId, retrievedAt, sourceTimestamp, sources: feed ? [url] : [],
    dataQualityNote: feed ? 'MLB feed facts only; absent fields are unavailable. No projected lineups, weather forecasts, or inferred injuries. Probable starters do not exclude relievers.' : `MLB live feed unavailable (${url}); no substitute data inferred.`,
    gameStatus: status && (status.abstractGameState || status.detailedState || status.codedGameState) ? available({ gameType: data?.game?.type ?? null, abstractState: status.abstractGameState ?? null, detailedState: status.detailedState ?? null, code: status.codedGameState ?? null }, 'Status reported by MLB; postseason game types are preserved.') : unavailable('Game status not supplied.'),
    probablePitchers: { home: probable('home'), away: probable('away') },
    confirmedLineups: { home: lineup('home'), away: lineup('away') },
    weather: weather && (weather.condition || weather.temp || weather.wind) ? available({ kind: 'OBSERVED', condition: weather.condition ?? null, temperatureF: weather.temp ?? null, wind: weather.wind ?? null }, 'Recorded game weather supplied by MLB; observed, not a forecast. Observation time is not supplied separately.') : unavailable('Recorded game weather not supplied; no forecast inferred.'),
    venue: venue && (venue.id || venue.name || venue.fieldInfo?.roofType || coordinates) ? available({ id: venue.id ?? null, name: venue.name ?? null, roofType: venue.fieldInfo?.roofType ?? null, latitude: coordinates?.latitude ?? null, longitude: coordinates?.longitude ?? null }, 'Only supplied venue metadata; roof type does not establish open/closed roof state.') : unavailable('Venue metadata not supplied.'),
    playerInjuries: injuries.length ? available(injuries, 'Explicit player status only; active status does not prove health, and absent players have unknown injury status.') : unavailable('No explicit player injury/status fields supplied; roster absence is not injury evidence.'),
    bullpenWorkload: unavailable('Previous-three-day pitcher boxscore usage is not acquired. Linescores alone cannot establish bullpen workload.'),
  };
}

export function withMLBPlayerContext(context: MLBResearchContext, game: Pick<MLBGame, 'homeTeam' | 'awayTeam'>, playerId: number | null, currentTeamId: number | null, isPitcher: boolean): MLBResearchContext {
  const evidence = <T>(value: T | null, source: string | null, dataQualityNote: string): MLBContextEvidence<T> => value === null
    ? { status: 'UNAVAILABLE', value: null, source, retrievedAt: context.retrievedAt, sourceTimestamp: null, dataQualityNote }
    : { status: 'AVAILABLE', value, source: source!, retrievedAt: context.retrievedAt, sourceTimestamp: null, dataQualityNote };
  const scheduledTeamIds = [game.homeTeam.id, game.awayTeam.id];
  const starters = Object.values(context.probablePitchers);
  const matchedStarter = starters.some(starter => starter.status === 'AVAILABLE' && starter.value.id === playerId);
  const allStartersKnown = starters.every(starter => starter.status === 'AVAILABLE');
  const starterEvidence = evidence(isPitcher && playerId && (matchedStarter || allStartersKnown) ? { playerId, isListedProbableStarter: matchedStarter } : null, context.sources[0] ?? null, 'Probable-starter evidence only; a nonmatch does not exclude a reliever or establish ineligibility.');
  starterEvidence.sourceTimestamp = context.sourceTimestamp;
  return { ...context, player: {
    teamMembership: evidence(currentTeamId == null ? null : { currentTeamId, scheduledTeamIds, matchesScheduledTeam: scheduledTeamIds.includes(currentTeamId) }, playerId && currentTeamId != null ? `${getMLBApiBaseUrl()}/people/${playerId}?hydrate=currentTeam` : null, 'Resolved currentTeam compared with scheduled team IDs; no team inferred from sportsbook player names.'),
    scheduledStarter: starterEvidence,
  } };
}