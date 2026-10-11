import { iso } from './evidence';
import { list, normalizeInjuries, normalizeNews, normalizeScheduleEvent, normalizeSummary, record } from './normalize';
import type { ContextGame, NBAContextSnapshot, SourceReference } from './types';

const BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba/';
export interface ProviderOptions {
  fetcher?: typeof fetch;
  now?: () => Date;
  maxRequests?: number;
  maxGamesPerTeam?: number;
}
export interface LoadContextRequest { gameId: string; teamId: number; asOf?: string }
interface Payload { data: unknown; source: SourceReference }

export function createNBAContextProvider(options: ProviderOptions = {}) {
  if (typeof window !== 'undefined') throw new Error('NBA context provider must run on the server.');
  if (options.maxRequests != null && (!Number.isInteger(options.maxRequests) || options.maxRequests < 1 || options.maxRequests > 100)
    || options.maxGamesPerTeam != null && (!Number.isInteger(options.maxGamesPerTeam) || options.maxGamesPerTeam < 1 || options.maxGamesPerTeam > 40)) throw new Error('Provider limits must be bounded positive integers.');
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  const maxRequests = Math.max(1, Math.min(100, options.maxRequests ?? 80));
  const maxGames = Math.max(1, Math.min(40, options.maxGamesPerTeam ?? 30));
  const pending = new Map<string, Promise<Payload | null>>();
  const expires = new Map<string, number>();
  const snapshots = new Map<string, Promise<NBAContextSnapshot>>();
  let count = 0;
  let active = 0;
  const waiting: Array<() => void> = [];
  async function bounded(work: () => Promise<Payload>): Promise<Payload> {
    if (active >= 4) await new Promise<void>(resolve => waiting.push(resolve));
    else active += 1;
    try { return await work(); }
    finally { const next = waiting.shift(); if (next) next(); else active -= 1; }
  }
  function request(path: string, ttl: number): Promise<Payload | null> {
    if (pending.has(path) && now().getTime() < (expires.get(path) ?? 0)) return pending.get(path)!;
    if (count >= maxRequests) return Promise.resolve(null);
    if (!/^(summary\?event=\d+|teams\/\d+\/schedule\?season=\d+&seasontype=[123]|injuries)$/.test(path)) throw new Error('Only allowlisted free ESPN context endpoints are permitted.');
    count += 1;
    expires.set(path, now().getTime() + ttl * 1000);
    pending.set(path, bounded(async () => {
      const url = new URL(path, BASE_URL).toString();
      const response = await fetcher(url, { headers: { accept: 'application/json' }, next: { revalidate: ttl }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error(`Free context request failed: ${response.status}`);
      const data: unknown = await response.json();
      const source: SourceReference = { id: path, provider: 'ESPN', url, recordId: null, publishedAt: null,
        updatedAt: iso(record(data).timestamp), fetchedAt: now().toISOString(), freshness: 'UNKNOWN' };
      return { data, source };
    }).catch(() => null));
    return pending.get(path)!;
  }
  async function load(input: LoadContextRequest): Promise<NBAContextSnapshot> {
    if (!/^\d+$/.test(input.gameId) || !Number.isInteger(input.teamId) || input.teamId <= 0) throw new Error('Numeric ESPN game and team IDs are required.');
    const requestedTime = input.asOf == null ? null : iso(input.asOf);
    if (input.asOf != null && !requestedTime || requestedTime && Date.parse(requestedTime) > now().getTime()) throw new Error('asOf must be a valid observation time, not in the future.');
    const missing: string[] = [];
    const payload = await request(`summary?event=${input.gameId}`, 120);
    const target = payload && normalizeSummary(payload.data, payload.source);
    if (!target || !target.seasonId || ![target.homeTeamId, target.awayTeamId].includes(input.teamId)) throw new Error('Target identity or official season metadata unavailable.');
    const cutoff = Math.min(Date.parse(requestedTime ?? now().toISOString()), Date.parse(target.startsAt));
    const teamIds = [target.homeTeamId, target.awayTeamId];
    const injuryRequest = request('injuries', 120);
    const schedules = await Promise.all(teamIds.flatMap(teamId => [1, 2, 3].map(phase => request(`teams/${teamId}/schedule?season=${target.seasonId}&seasontype=${phase}`, 300))));
    const calendar = [...new Map(schedules.flatMap(payload => {
      if (!payload) { missing.push('Team/phase schedule unavailable or request budget exhausted.'); return []; }
      if (!Array.isArray(record(payload.data).events)) { missing.push('Team/phase schedule payload has no events array; coverage unknown.'); return []; }
      return list(record(payload.data).events).flatMap(event => {
        const game = normalizeScheduleEvent(event, payload.source);
        return game && game.seasonId === target.seasonId ? [game] : [];
      });
    }).map(game => [game.gameId, game])).values()];
    const eligible = calendar.filter(game => game.gameId !== target.gameId && game.completed && Date.parse(game.startsAt) < cutoff);
    const selected = [...new Map(teamIds.flatMap(teamId => eligible.filter(game => game.homeTeamId === teamId || game.awayTeamId === teamId)
      .sort((first, second) => Number(second.phase === target.phase) - Number(first.phase === target.phase) || second.startsAt.localeCompare(first.startsAt)).slice(0, maxGames)).map(game => [game.gameId, game])).values()];
    if (eligible.length > selected.length) missing.push(`Historical summary coverage bounded to ${maxGames} games per team; other events remain schedule-only.`);
    const extraSeriesEvents = target.seriesEventIds.filter(id => id !== target.gameId && /^\d+$/.test(id) && !selected.some(game => game.gameId === id));
    const seriesEvents = extraSeriesEvents.slice(0, 7);
    if (extraSeriesEvents.length > seriesEvents.length) missing.push('Series summary coverage capped to seven additional events; stakes may remain incomplete.');
    const ids = [...selected.map(game => game.gameId), ...seriesEvents];
    const details = await Promise.all(ids.map(id => request(`summary?event=${id}`, 3600)));
    const games: ContextGame[] = [];
    const news = payload ? normalizeNews(payload.data, payload.source) : [];
    for (let index = 0; index < details.length; index += 1) {
      const detail = details[index];
      const game = detail && normalizeSummary(detail.data, detail.source);
      if (!game || game.gameId !== ids[index]) { missing.push(`Summary ${ids[index]} unavailable, malformed or outside request budget.`); continue; }
      games.push(game);
      news.push(...normalizeNews(detail!.data, detail!.source));
    }
    const injuries = await injuryRequest;
    const validInjuries = injuries != null && Array.isArray(record(injuries.data).injuries) && iso(record(injuries.data).timestamp) != null;
    if (!validInjuries) missing.push('Current injury feed unavailable, malformed or request budget exhausted.');
    const asOf = requestedTime ?? now().toISOString();
    return { target, asOf, games, calendar, injuries: validInjuries ? normalizeInjuries(injuries!.data, injuries!.source) : [],
      injuryFeed: { state: validInjuries ? 'AVAILABLE' : 'UNAVAILABLE', source: injuries?.source ?? null }, news,
      missing: [...new Set(missing)] };
  }
  return {
    loadSnapshot(input: LoadContextRequest): Promise<NBAContextSnapshot> {
      const key = `${input.gameId}:${input.teamId}:${input.asOf ?? `live-${Math.floor(now().getTime() / 120000)}`}`;
      if (!snapshots.has(key)) snapshots.set(key, load(input));
      return snapshots.get(key)!;
    },
    requestsUsed() { return count; },
  };
}