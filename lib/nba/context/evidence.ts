import type { BuildEnvironment, ContextGame, NBAEvidence, NBAMarket, SampleDescription, SourceReference } from './types';

export const ALL_MARKETS: NBAMarket[] = ['points', 'rebounds', 'assists', '3pm', 'pra', 'pr', 'pa', 'ra', 'steals', 'blocks', 'turnovers', 'minutes'];
export const iso = (value: unknown): string | null => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;

export function freshness(source: SourceReference, cutoff: string, maxAgeHours: number): SourceReference['freshness'] {
  if (!iso(source.fetchedAt) || !iso(cutoff)) return 'UNKNOWN';
  if (Date.parse(source.fetchedAt) > Date.parse(cutoff)) return 'AFTER_CUTOFF';
  const stamp = source.updatedAt ?? source.publishedAt;
  if (!stamp) return 'UNKNOWN';
  const age = Date.parse(cutoff) - Date.parse(stamp);
  if (!Number.isFinite(age) || age < 0) return 'AFTER_CUTOFF';
  return age <= maxAgeHours * 3600000 ? 'FRESH' : 'STALE';
}

export function priorCompleted(game: ContextGame, target: ContextGame, cutoff: string): boolean {
  return game.gameId !== target.gameId && game.seasonId != null && game.seasonId === target.seasonId
    && game.completed && game.completedAt != null && Date.parse(game.completedAt) < Date.parse(cutoff)
    && Date.parse(game.startsAt) <= Date.parse(game.completedAt) && Date.parse(game.startsAt) < Date.parse(cutoff)
    && iso(game.source.fetchedAt) != null && Date.parse(game.source.fetchedAt) <= Date.parse(cutoff);
}

export function sample(env: BuildEnvironment, games: ContextGame[], measured: number, conditions: string[] = [], excluded: string[] = []): SampleDescription {
  const dates = games.map(game => game.startsAt).sort();
  return { gameIds: games.map(game => game.gameId), from: dates[0] ?? null, to: dates.at(-1) ?? null,
    seasonId: env.snapshot.target.seasonId ?? 'UNKNOWN', phase: env.snapshot.target.phase,
    conditions, measured, eligible: games.length, excluded };
}

export function addEvidence(env: BuildEnvironment, entry: Pick<NBAEvidence, 'id' | 'metric' | 'detail' | 'correlationGroup'> & Partial<NBAEvidence>): string {
  if (env.evidence.some(evidence => evidence.id === entry.id)) throw new Error(`Duplicate evidence ID: ${entry.id}`);
  const available = entry.value != null;
  const evidence: NBAEvidence = {
    kind: available ? 'DERIVED' : 'UNAVAILABLE', state: available ? 'AVAILABLE' : 'UNAVAILABLE',
    value: null, units: null, direction: available ? 'NEUTRAL' : 'UNKNOWN', directionBasis: null,
    markets: ALL_MARKETS, reliability: available ? 'MEDIUM' : 'UNKNOWN', reliabilityReasons: [],
    sourceRefs: [], sample: null, missingReasons: available ? [] : [entry.detail], dependencyIds: [], ...entry,
  };
  if (evidence.kind === 'UNAVAILABLE') {
    evidence.state = evidence.state === 'UNKNOWN' ? 'UNKNOWN' : 'UNAVAILABLE';
    evidence.value = null;
    evidence.direction = 'UNKNOWN';
    evidence.reliability = 'UNKNOWN';
  }
  if (evidence.sample && evidence.sample.measured < 5 && evidence.kind !== 'FACT' && evidence.kind !== 'UNAVAILABLE') {
    evidence.reliability = 'LOW';
    evidence.reliabilityReasons.push(`Small descriptive sample (n=${evidence.sample.measured}); not a forecast.`);
  }
  if (evidence.direction !== 'NEUTRAL' && evidence.direction !== 'UNKNOWN' && !evidence.directionBasis) throw new Error('Directional evidence requires a basis.');
  if (evidence.value == null && evidence.kind !== 'UNAVAILABLE') {
    evidence.kind = 'UNAVAILABLE';
    evidence.state = 'UNAVAILABLE';
    evidence.direction = 'UNKNOWN';
    evidence.reliability = 'UNKNOWN';
    if (!evidence.missingReasons.length) evidence.missingReasons.push(evidence.detail);
  }
  env.evidence.push(evidence);
  return evidence.id;
}

export const mean = (values: number[]): number | null => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
export function describe(values: number[]) {
  const average = mean(values);
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return { n: values.length, mean: average, median: sorted.length ? sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2 : null,
    min: sorted[0] ?? null, max: sorted.at(-1) ?? null,
    sd: average != null && values.length > 1 ? Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length) : null };
}

export const sources = (games: ContextGame[]): SourceReference[] => [...new Map(games.map(game => [game.source.id, game.source])).values()];

export function freezeSnapshot<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeSnapshot(child);
    Object.freeze(value);
  }
  return value;
}