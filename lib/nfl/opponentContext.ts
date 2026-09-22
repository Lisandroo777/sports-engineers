import { espnSiteFetch } from './client';
import { nflSeasonYear } from './stats';
import type { NFLAnalyzableMarketKey } from './oddsTypes';

export type NFLDefenseMetricKey = 'passingYardsAllowed' | 'completionsAllowed' | 'passAttemptsAllowed' | 'sacksGenerated' | 'rushingYardsAllowed' | 'rushingAttemptsAllowed' | 'yardsPerRushAttemptAllowed';
export type NFLOpponentTrend = 'INCREASING' | 'DECREASING' | 'STABLE' | 'INSUFFICIENT_SAMPLE';

export interface NFLDefenseGame {
  eventId: string;
  date: string;
  season: number;
  metrics: Partial<Record<NFLDefenseMetricKey, number>>;
}

export interface NFLOpponentMetric {
  key: NFLDefenseMetricKey;
  label: string;
  l3: { games: number; mean: number | null };
  l5: { games: number; mean: number | null };
  l10: { games: number; mean: number | null };
  season: { games: number; mean: number | null };
  trend: NFLOpponentTrend;
}

export interface NFLOpponentContext {
  opponentTeamId: number;
  status: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
  sampleSize: number;
  trend: NFLOpponentTrend;
  sourceStatus: { provider: 'ESPN'; schedule: 'AVAILABLE' | 'UNAVAILABLE'; boxscores: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE' };
  metrics: NFLOpponentMetric[];
  availableMetrics: string[];
  missingFields: string[];
  evidence: string[];
}

interface RawSummary {
  boxscore?: {
    teams?: Array<{ team?: { id?: string }; statistics?: Array<{ name?: string; value?: number; displayValue?: string }> }>;
    players?: Array<{ team?: { id?: string }; statistics?: Array<{ name?: string; labels?: string[]; athletes?: Array<{ stats?: string[] }> }> }>;
  };
}

interface RawSchedule {
  events?: Array<{ id: string; date: string; competitions?: Array<{ status?: { type?: { completed?: boolean } } }> }>;
}

const LABELS: Record<NFLDefenseMetricKey, string> = {
  passingYardsAllowed: 'QB passing yards allowed',
  completionsAllowed: 'Completions allowed',
  passAttemptsAllowed: 'Pass attempts faced',
  sacksGenerated: 'Sacks generated',
  rushingYardsAllowed: 'Rushing yards allowed',
  rushingAttemptsAllowed: 'Rushing attempts faced',
  yardsPerRushAttemptAllowed: 'Yards per rush allowed',
};

const PASS_MARKETS = new Set<NFLAnalyzableMarketKey>(['player_pass_yds', 'player_pass_tds', 'player_pass_completions', 'player_pass_attempts', 'player_pass_interceptions', 'player_pass_longest_completion']);
const RUSH_MARKETS = new Set<NFLAnalyzableMarketKey>(['player_rush_yds', 'player_rush_attempts', 'player_rush_tds', 'player_rush_longest', 'player_rush_rec_yds']);
const RECEIVING_MARKETS = new Set<NFLAnalyzableMarketKey>(['player_reception_yds', 'player_receptions', 'player_reception_tds', 'player_reception_longest']);

function numeric(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pair(value: string | undefined): [number, number] | null {
  const match = value?.match(/^(\d+)\/(\d+)$/);
  return match ? [Number(match[1]), Number(match[2])] : null;
}

function firstNumber(value: string | undefined): number | null {
  const match = value?.match(/^-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

export function parseNFLDefenseGame(summary: RawSummary, defenseTeamId: number, eventId: string, date: string, season: number): NFLDefenseGame | null {
  if (!summary.boxscore?.teams?.some((entry) => Number(entry.team?.id) === defenseTeamId)) return null;
  const offenseTeam = summary.boxscore?.teams?.find((entry) => Number(entry.team?.id) !== defenseTeamId);
  if (!offenseTeam) return null;
  const teamStats = new Map((offenseTeam.statistics ?? []).map((stat) => [stat.name, stat]));
  const offenseId = Number(offenseTeam.team?.id);
  const passing = summary.boxscore?.players?.find((entry) => Number(entry.team?.id) === offenseId)
    ?.statistics?.find((group) => group.name === 'passing');
  const completionIndex = passing?.labels?.indexOf('C/ATT') ?? -1;
  const yardsIndex = passing?.labels?.indexOf('YDS') ?? -1;
  const sacksIndex = passing?.labels?.indexOf('SACKS') ?? -1;
  let completions = 0;
  let attempts = 0;
  let passingYards = 0;
  let sacks = 0;
  let hasPassing = false;
  for (const athlete of passing?.athletes ?? []) {
    const completionAttempts = completionIndex >= 0 ? pair(athlete.stats?.[completionIndex]) : null;
    const yards = yardsIndex >= 0 ? numeric(athlete.stats?.[yardsIndex]) : null;
    const sacksTaken = sacksIndex >= 0 ? firstNumber(athlete.stats?.[sacksIndex]) : null;
    if (completionAttempts) { completions += completionAttempts[0]; attempts += completionAttempts[1]; hasPassing = true; }
    if (yards != null) { passingYards += yards; hasPassing = true; }
    if (sacksTaken != null) sacks += sacksTaken;
  }
  const statValue = (name: string) => {
    const stat = teamStats.get(name);
    return numeric(stat?.value) ?? numeric(stat?.displayValue);
  };
  const metrics: NFLDefenseGame['metrics'] = {};
  if (hasPassing) {
    metrics.passingYardsAllowed = passingYards;
    metrics.completionsAllowed = completions;
    metrics.passAttemptsAllowed = attempts;
    metrics.sacksGenerated = sacks;
  }
  const rushingYards = statValue('rushingYards');
  const rushingAttempts = statValue('rushingAttempts');
  const yardsPerRush = statValue('yardsPerRushAttempt');
  if (rushingYards != null) metrics.rushingYardsAllowed = rushingYards;
  if (rushingAttempts != null) metrics.rushingAttemptsAllowed = rushingAttempts;
  if (yardsPerRush != null) metrics.yardsPerRushAttemptAllowed = yardsPerRush;
  return Object.keys(metrics).length ? { eventId, date, season, metrics } : null;
}

function summarize(games: NFLDefenseGame[], key: NFLDefenseMetricKey, size: number | null, season?: number) {
  const eligible = season == null ? games : games.filter((game) => game.season === season);
  const values = (size == null ? eligible : eligible.slice(-size)).map((game) => game.metrics[key]).filter((value): value is number => value != null);
  return { games: values.length, mean: values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : null };
}

function metricTrend(l3: NFLOpponentMetric['l3'], baseline: NFLOpponentMetric['l10']): NFLOpponentTrend {
  if (l3.games < 3 || baseline.games < 3 || l3.mean == null || baseline.mean == null || baseline.mean === 0) return 'INSUFFICIENT_SAMPLE';
  const delta = (l3.mean - baseline.mean) / baseline.mean;
  return delta >= 0.15 ? 'INCREASING' : delta <= -0.15 ? 'DECREASING' : 'STABLE';
}

function metricKeysFor(market: NFLAnalyzableMarketKey): NFLDefenseMetricKey[] {
  if (PASS_MARKETS.has(market)) return ['passingYardsAllowed', 'completionsAllowed', 'passAttemptsAllowed', 'sacksGenerated'];
  if (RUSH_MARKETS.has(market)) return ['rushingYardsAllowed', 'rushingAttemptsAllowed', 'yardsPerRushAttemptAllowed'];
  if (RECEIVING_MARKETS.has(market)) return ['passingYardsAllowed', 'completionsAllowed', 'passAttemptsAllowed', 'sacksGenerated'];
  return [];
}

export function buildNFLOpponentContext(params: { opponentTeamId: number; games: NFLDefenseGame[]; market: NFLAnalyzableMarketKey; position?: string | null; season?: number }): NFLOpponentContext {
  const season = params.season ?? nflSeasonYear();
  const keys = metricKeysFor(params.market);
  const metrics = keys.map((key) => {
    const l3 = summarize(params.games, key, 3);
    const l5 = summarize(params.games, key, 5);
    const l10 = summarize(params.games, key, 10);
    const seasonWindow = summarize(params.games, key, null, season);
    return { key, label: LABELS[key], l3, l5, l10, season: seasonWindow, trend: metricTrend(l3, l10) };
  }).filter((metric) => metric.l10.games > 0 || metric.season.games > 0);
  const missingFields = ['coverage grade', 'pressure rate', 'pass-rush win rate'];
  if (RECEIVING_MARKETS.has(params.market)) {
    missingFields.push(params.position === 'RB' ? 'receptions allowed to running backs' : 'receptions allowed by receiver position');
    missingFields.push(params.position === 'RB' ? 'receiving yards allowed to running backs' : 'receiving yards allowed by receiver position', 'targets allowed by position');
  }
  const availableMetrics = metrics.map((metric) => metric.key);
  const sampleSize = Math.max(0, ...metrics.map((metric) => metric.l10.games));
  const trends = metrics.map((metric) => metric.trend).filter((trend) => trend !== 'INSUFFICIENT_SAMPLE');
  const trend: NFLOpponentTrend = trends.includes('INCREASING') ? 'INCREASING' : trends.includes('DECREASING') ? 'DECREASING' : trends.length ? 'STABLE' : 'INSUFFICIENT_SAMPLE';
  const status = metrics.length === 0 ? 'UNAVAILABLE' : missingFields.length ? 'PARTIAL' : 'AVAILABLE';
  const evidence = metrics.map((metric) => `${metric.label}: L3 ${metric.l3.mean ?? 'unavailable'} (${metric.l3.games}), L10 ${metric.l10.mean ?? 'unavailable'} (${metric.l10.games}), season ${metric.season.mean ?? 'unavailable'} (${metric.season.games})`);
  return {
    opponentTeamId: params.opponentTeamId,
    status,
    sampleSize,
    trend,
    sourceStatus: { provider: 'ESPN', schedule: params.games.length ? 'AVAILABLE' : 'UNAVAILABLE', boxscores: metrics.length ? (metrics.length === keys.length ? 'AVAILABLE' : 'PARTIAL') : 'UNAVAILABLE' },
    metrics,
    availableMetrics,
    missingFields,
    evidence,
  };
}

async function scheduleEvents(teamId: number, season: number) {
  const data = await espnSiteFetch<RawSchedule>(`teams/${teamId}/schedule`, { season: String(season) }, 3600);
  return (data.events ?? []).filter((event) => event.competitions?.[0]?.status?.type?.completed).map((event) => ({ ...event, season }));
}

export async function getNFLOpponentDefenseGames(teamId: number, season = nflSeasonYear()): Promise<NFLDefenseGame[]> {
  const [current, previous] = await Promise.all([
    scheduleEvents(teamId, season).catch(() => []),
    scheduleEvents(teamId, season - 1).catch(() => []),
  ]);
  const events = [...previous, ...current].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).slice(-10);
  const games = await Promise.all(events.map(async (event) => {
    try {
      const summary = await espnSiteFetch<RawSummary>('summary', { event: event.id }, 3600);
      return parseNFLDefenseGame(summary, teamId, event.id, event.date, event.season);
    } catch {
      return null;
    }
  }));
  return games.filter((game): game is NFLDefenseGame => game != null);
}