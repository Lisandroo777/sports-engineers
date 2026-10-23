import { espnNBAWebFetch } from '../../client';
import { NBA_V2_MODEL_VERSION, projectNBAEarlySeason, type NBAV2Observation } from './earlySeason';
import { NBA_V2_VALIDATION } from './validation';

export const NBA_V2_DIAGNOSTIC_LABEL = 'RESEARCH ONLY — UNVALIDATED NBA V2 ESTIMATE. NOT A PICK.';
// Only these markets were calibration-tested in reports/nba-v2/validation.json.
const V2_MARKET_STATS: Record<string, string> = { points: 'points', rebounds: 'totalRebounds', assists: 'assists' };
const MAX_PLAYERS = 80;

export interface NBAV2CandidateInput {
  candidateId: string;
  playerId: number | null;
  player: string;
  marketKey: string;
  line: number;
  direction: 'over' | 'under';
  odds: number | null;
  book: string | null;
  tipoff: string | null;
}

export interface NBAV2Diagnostic {
  label: typeof NBA_V2_DIAGNOSTIC_LABEL;
  modelVersion: typeof NBA_V2_MODEL_VERSION;
  publishable: false;
  candidateId: string;
  player: string;
  market: string;
  line: number;
  side: 'over' | 'under';
  odds: number | null;
  book: string | null;
  status: 'EVALUATED' | 'UNSUPPORTED_MARKET' | 'INSUFFICIENT_PRIOR_SEASON' | 'NO_PRICE' | 'NOT_EVALUATED';
  probability: number | null;
  hypotheticalEvPercent: number | null;
  expectedStat: number | null;
  priorSeasonGames: number;
  currentSeasonGames: number;
  reasons: string[];
}

type Log = { gameId: string; date: string; stat: Record<string, number> };

async function regularSeasonLogs(playerId: number, season: number): Promise<Log[]> {
  const data = await espnNBAWebFetch<{ names?: string[]; events?: Record<string, { gameDate?: string }>;
    seasonTypes?: Array<{ displayName?: string; categories?: Array<{ events?: Array<{ eventId: string; stats?: string[] }> }> }> }>(
    `common/v3/sports/basketball/nba/athletes/${playerId}/gamelog`, { season: String(season) }, 3600);
  const names = data.names ?? [];
  const rows = new Map<string, Log>();
  for (const type of data.seasonTypes ?? []) {
    if (!/regular season/i.test(type.displayName ?? '')) continue;
    for (const category of type.categories ?? []) for (const event of category.events ?? []) {
      const date = data.events?.[event.eventId]?.gameDate;
      if (date) rows.set(event.eventId, { gameId: event.eventId, date, stat: Object.fromEntries(names.map((name, index) => [name, Number(event.stats?.[index])])) });
    }
  }
  return [...rows.values()];
}

/** ESPN season year is the year the season ends (2025-26 => 2026). */
export function nbaSeasonYear(tipoff: string): number {
  const date = new Date(tipoff);
  return date.getUTCMonth() >= 7 ? date.getUTCFullYear() + 1 : date.getUTCFullYear();
}

export function hypotheticalEvPercent(probability: number, americanOdds: number): number {
  const profit = americanOdds > 0 ? americanOdds / 100 : 100 / -americanOdds;
  return (probability * profit - (1 - probability)) * 100;
}

export async function buildNBAV2Diagnostics(candidates: NBAV2CandidateInput[],
  loadLogs: (playerId: number, season: number) => Promise<Log[]> = regularSeasonLogs): Promise<NBAV2Diagnostic[]> {
  const players = [...new Set(candidates.filter(row => row.playerId != null && row.tipoff && V2_MARKET_STATS[row.marketKey])
    .map(row => `${row.playerId}:${nbaSeasonYear(row.tipoff!)}`))].slice(0, MAX_PLAYERS);
  const logs = new Map<string, { prior: Log[]; current: Log[] } | null>();
  const deadline = Date.now() + 8000;
  for (let index = 0; index < players.length && Date.now() < deadline; index += 4) {
    // A slow free provider must never hold up the normal NBA search beyond the budget.
    await Promise.race([Promise.all(players.slice(index, index + 4).map(async key => {
      const [playerId, season] = key.split(':').map(Number);
      try { logs.set(key, { prior: await loadLogs(playerId, season - 1), current: await loadLogs(playerId, season) }); }
      catch { logs.set(key, null); }
    })), new Promise(resolve => setTimeout(resolve, Math.max(0, deadline - Date.now())))]);
  }
  return candidates.map(row => {
    const base = { label: NBA_V2_DIAGNOSTIC_LABEL as typeof NBA_V2_DIAGNOSTIC_LABEL, modelVersion: NBA_V2_MODEL_VERSION as typeof NBA_V2_MODEL_VERSION, publishable: false as const, candidateId: row.candidateId,
      player: row.player, market: row.marketKey, line: row.line, side: row.direction, odds: row.odds, book: row.book,
      probability: null, hypotheticalEvPercent: null, expectedStat: null, priorSeasonGames: 0, currentSeasonGames: 0,
      reasons: [...NBA_V2_VALIDATION.reasons] };
    const statKey = V2_MARKET_STATS[row.marketKey];
    if (!statKey) return { ...base, status: 'UNSUPPORTED_MARKET' as const, reasons: [...base.reasons, 'V2 is only calibration-tested for points, rebounds and assists.'] };
    const history = row.playerId != null && row.tipoff ? logs.get(`${row.playerId}:${nbaSeasonYear(row.tipoff)}`) : undefined;
    if (!history) return { ...base, status: 'NOT_EVALUATED' as const, reasons: [...base.reasons, 'Player history unavailable or outside the bounded free-data budget.'] };
    const observe = (rows: Log[]): NBAV2Observation[] => rows.map(log => ({ gameId: log.gameId, date: log.date, minutes: log.stat.minutes, value: log.stat[statKey] }));
    const projection = projectNBAEarlySeason({ priorSeason: observe(history.prior), currentSeason: observe(history.current), targetTipoff: row.tipoff!, line: row.line });
    const counts = { priorSeasonGames: projection.priorSeasonGames, currentSeasonGames: projection.currentSeasonGames };
    if (projection.status !== 'AVAILABLE') return { ...base, ...counts, status: 'INSUFFICIENT_PRIOR_SEASON' as const, reasons: [...base.reasons, ...projection.reasons] };
    const probability = row.direction === 'over' ? projection.overProbability! : 1 - projection.overProbability!;
    const priced = row.odds != null && Number.isInteger(row.odds) && Math.abs(row.odds) >= 100;
    return { ...base, ...counts, status: priced ? 'EVALUATED' as const : 'NO_PRICE' as const, probability, expectedStat: projection.expectedStat,
      hypotheticalEvPercent: priced ? hypotheticalEvPercent(probability, row.odds!) : null, reasons: [...base.reasons, ...projection.reasons] };
  });
}
