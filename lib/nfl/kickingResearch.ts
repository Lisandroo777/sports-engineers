import type { NFLGameLogEntry } from './types';
import type { NFLWeatherContext } from './weather';
import type { NFLInjuryContext } from './injuries';

export interface NFLKickingFact {
  value: number;
  source: string;
  retrievedAt: string;
  sampleId: string;
}

export interface NFLKickingOpportunityInput {
  teamDrives?: NFLKickingFact | null;
  teamRedZoneTrips?: NFLKickingFact | null;
  teamRedZoneTouchdowns?: NFLKickingFact | null;
  opponentRedZoneTrips?: NFLKickingFact | null;
  opponentRedZoneTouchdowns?: NFLKickingFact | null;
  fourthDownAttempts?: NFLKickingFact | null;
  fourthDownOpportunities?: NFLKickingFact | null;
  expectedDrives?: NFLKickingFact | null;
  teamTotal?: NFLKickingFact | null;
}

export interface NFLKickingObservedStat {
  total: number | null;
  observedGames: number;
  perGame: number | null;
}

export interface NFLKickingRate {
  numerator: number;
  denominator: number;
  rate: number | null;
  observedGames: number | null;
}

export interface NFLKickingOpportunityRate extends NFLKickingRate {
  source: string;
  retrievedAt: string;
  sampleId: string;
}

export interface NFLKickingDistanceResearch {
  made: NFLKickingObservedStat;
  attempted: NFLKickingObservedStat;
  accuracy: NFLKickingRate | null;
}

export interface NFLKickingWindow extends NFLKickingDistanceResearch {
  label: string;
  games: number;
  seasons: number[];
  seasonCount: number;
  gamesWithoutSeason: number;
  kickingPoints: NFLKickingObservedStat;
  longestFieldGoal: number | null;
  longestFieldGoalObservedGames: number;
  distance: Record<'under40' | 'from40To49' | 'from50Plus', NFLKickingDistanceResearch>;
}

export interface NFLKickingEvidence {
  id: string;
  status: 'AVAILABLE' | 'UNAVAILABLE';
  source: string | null;
  retrievedAt: string | null;
  reason: string | null;
}

export interface NFLKickingResearchInput {
  logs: readonly NFLGameLogEntry[];
  season: number;
  before?: string;
  careerLogs?: readonly NFLGameLogEntry[];
  opportunity?: NFLKickingOpportunityInput | null;
  weatherContext?: NFLWeatherContext | null;
  injuryContext?: NFLInjuryContext | null;
}

export interface NFLKickingResearch {
  recentL3: NFLKickingWindow;
  recentL5: NFLKickingWindow;
  currentSeason: NFLKickingWindow;
  career: NFLKickingWindow | null;
  opportunity: {
    facts: Record<keyof NFLKickingOpportunityInput, NFLKickingFact | null>;
    teamRedZoneTouchdownRate: NFLKickingOpportunityRate | null;
    opponentRedZoneTouchdownRate: NFLKickingOpportunityRate | null;
    teamRedZoneTripsPerDrive: NFLKickingOpportunityRate | null;
    fourthDownAttemptRate: NFLKickingOpportunityRate | null;
  };
  weatherContext: NFLWeatherContext | null;
  injuryContext: NFLInjuryContext | null;
  evidence: NFLKickingEvidence[];
  unavailableEvidence: NFLKickingEvidence[];
}

const opportunityKeys = [
  'teamDrives', 'teamRedZoneTrips', 'teamRedZoneTouchdowns', 'opponentRedZoneTrips',
  'opponentRedZoneTouchdowns', 'fourthDownAttempts', 'fourthDownOpportunities',
  'expectedDrives', 'teamTotal',
] as const;

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && Number.isInteger(value) ? value : null;
}

function stat(log: NFLGameLogEntry, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = count(log.stats[key]);
    if (value !== null) return value;
  }
  return null;
}

function observed(logs: readonly NFLGameLogEntry[], keys: readonly string[]): NFLKickingObservedStat {
  const values = logs.map((log) => stat(log, keys)).filter((value): value is number => value !== null);
  const total = values.length ? values.reduce((sum, value) => sum + value, 0) : null;
  return { total, observedGames: values.length, perGame: total === null ? null : total / values.length };
}

function distance(logs: readonly NFLGameLogEntry[], madeKeys: readonly string[], attemptedKeys: readonly string[]): NFLKickingDistanceResearch {
  const pairs = logs.flatMap((log) => {
    const made = stat(log, madeKeys);
    const attempted = stat(log, attemptedKeys);
    return made !== null && attempted !== null && made <= attempted ? [{ made, attempted }] : [];
  });
  const numerator = pairs.reduce((sum, pair) => sum + pair.made, 0);
  const denominator = pairs.reduce((sum, pair) => sum + pair.attempted, 0);
  return {
    made: observed(logs, madeKeys), attempted: observed(logs, attemptedKeys),
    accuracy: pairs.length ? { numerator, denominator, rate: denominator > 0 ? numerator / denominator : null, observedGames: pairs.length } : null,
  };
}

function uniqueLogs(logs: readonly NFLGameLogEntry[], before?: string): NFLGameLogEntry[] {
  const cutoff = before === undefined ? null : Date.parse(before);
  const completed = logs.filter((log) => log.result != null && (cutoff === null || Date.parse(log.date) < cutoff));
  return [...new Map(completed.map((log) => [log.gameId, log])).values()]
    .sort((left, right) => right.date.localeCompare(left.date) || right.gameId.localeCompare(left.gameId));
}

function windowResearch(logs: readonly NFLGameLogEntry[], label: string): NFLKickingWindow {
  const seasons = [...new Set(logs.flatMap((log) => log.season === undefined ? [] : [log.season]))].sort((left, right) => left - right);
  const longest = logs.map((log) => stat(log, ['longestFieldGoal', 'longFieldGoal'])).filter((value): value is number => value !== null);
  return {
    label, games: logs.length, seasons, seasonCount: seasons.length,
    gamesWithoutSeason: logs.filter((log) => log.season === undefined).length,
    ...distance(logs, ['fieldGoalsMade', 'fgm'], ['fieldGoalAttempts', 'fieldGoalsAttempted', 'fga']),
    kickingPoints: observed(logs, ['kickingPoints']),
    longestFieldGoal: longest.length ? Math.max(...longest) : null,
    longestFieldGoalObservedGames: longest.length,
    distance: {
      under40: distance(logs, ['fieldGoalsMadeUnder40'], ['fieldGoalAttemptsUnder40', 'fieldGoalsAttemptedUnder40']),
      from40To49: distance(logs, ['fieldGoalsMade40_49', 'fieldGoalsMade40To49'], ['fieldGoalAttempts40_49', 'fieldGoalsAttempted40To49']),
      from50Plus: distance(logs, ['fieldGoalsMade50Plus'], ['fieldGoalAttempts50Plus', 'fieldGoalsAttempted50Plus']),
    },
  };
}

function validFact(fact: NFLKickingFact | null | undefined, integer: boolean): NFLKickingFact | null {
  if (!fact || typeof fact.value !== 'number' || !Number.isFinite(fact.value) || fact.value < 0
    || (integer && !Number.isInteger(fact.value)) || !fact.source?.trim() || !fact.sampleId?.trim()
    || !Number.isFinite(Date.parse(fact.retrievedAt))) return null;
  return { ...fact };
}

function factRate(numerator: NFLKickingFact | null, denominator: NFLKickingFact | null): NFLKickingOpportunityRate | null {
  if (!numerator || !denominator || numerator.sampleId !== denominator.sampleId
    || numerator.source !== denominator.source || numerator.retrievedAt !== denominator.retrievedAt
    || numerator.value > denominator.value) return null;
  return { numerator: numerator.value, denominator: denominator.value,
    rate: denominator.value > 0 ? numerator.value / denominator.value : null, observedGames: null,
    source: numerator.source, retrievedAt: numerator.retrievedAt, sampleId: numerator.sampleId };
}

export function getNFLKickingResearch(input: NFLKickingResearchInput): NFLKickingResearch {
  const logs = uniqueLogs(input.logs, input.before);
  const recentL3 = windowResearch(logs.slice(0, 3), 'Last 3 supplied games');
  const recentL5 = windowResearch(logs.slice(0, 5), 'Last 5 supplied games');
  const currentSeason = windowResearch(logs.filter((log) => log.season === input.season), `Season ${input.season}`);
  const suppliedCareer = input.careerLogs === undefined ? null : uniqueLogs(input.careerLogs, input.before);
  const career = suppliedCareer === null ? null : windowResearch(suppliedCareer, 'Supplied history only');
  if (career) career.label = `Supplied history: ${career.seasonCount} observed seasons (not verified full career)`;
  const facts = Object.fromEntries(opportunityKeys.map((key) => [key,
    validFact(input.opportunity?.[key], key !== 'expectedDrives' && key !== 'teamTotal'),
  ])) as NFLKickingResearch['opportunity']['facts'];
  const opportunity: NFLKickingResearch['opportunity'] = {
    facts,
    teamRedZoneTouchdownRate: factRate(facts.teamRedZoneTouchdowns, facts.teamRedZoneTrips),
    opponentRedZoneTouchdownRate: factRate(facts.opponentRedZoneTouchdowns, facts.opponentRedZoneTrips),
    teamRedZoneTripsPerDrive: factRate(facts.teamRedZoneTrips, facts.teamDrives),
    fourthDownAttemptRate: factRate(facts.fourthDownAttempts, facts.fourthDownOpportunities),
  };
  const evidence: NFLKickingEvidence[] = [];
  function record(id: string, available: boolean, source: string | null, retrievedAt: string | null, reason: string) {
    evidence.push({ id, status: available ? 'AVAILABLE' : 'UNAVAILABLE', source, retrievedAt, reason: available ? null : reason });
  }
  for (const [name, sample] of Object.entries({ recentL3, recentL5, currentSeason, career })) {
    record(`${name}.sample`, Boolean(sample?.games), sample ? 'Supplied NFLGameLogEntry[]' : null, null, 'No supplied games for this sample.');
    if (!sample) continue;
    const metrics = {
      made: sample.made.total, attempted: sample.attempted.total, accuracy: sample.accuracy?.rate,
      kickingPoints: sample.kickingPoints.total, longestFieldGoal: sample.longestFieldGoal,
      ...Object.fromEntries(Object.entries(sample.distance).flatMap(([band, values]) => [
        [`${band}.made`, values.made.total], [`${band}.attempted`, values.attempted.total], [`${band}.accuracy`, values.accuracy?.rate],
      ])),
    };
    for (const [metric, value] of Object.entries(metrics)) {
      record(`${name}.${metric}`, value != null, 'Supplied NFLGameLogEntry.stats', null,
        'Exact stat or valid paired made/attempted denominator unavailable; missing values are not zero.');
    }
    record(`${name}.seasonCoverage`, sample.gamesWithoutSeason === 0 && sample.games > 0,
      'Supplied NFLGameLogEntry.season', null, 'Season metadata unavailable for one or more games.');
  }
  for (const key of opportunityKeys) {
    const fact = facts[key];
    record(`opportunity.${key}`, fact !== null, fact?.source ?? null, fact?.retrievedAt ?? null,
      'Exact sourced value, timestamp, and sample identity required.');
  }
  for (const key of ['teamRedZoneTouchdownRate', 'opponentRedZoneTouchdownRate', 'teamRedZoneTripsPerDrive', 'fourthDownAttemptRate'] as const) {
    record(`opportunity.${key}`, opportunity[key]?.rate != null, opportunity[key]?.source ?? null, opportunity[key]?.retrievedAt ?? null,
      'Matching sourced numerator and positive denominator required; conversions do not establish decision opportunities.');
  }
  const weatherContext = input.weatherContext ?? null;
  record('weather.context', weatherContext !== null, weatherContext?.sources.venue ?? null, weatherContext?.forecastTimestamp ?? null, 'Weather context not supplied.');
  for (const key of ['wind', 'gusts', 'temperature', 'precipitation', 'conditions'] as const) {
    record(`weather.${key}`, weatherContext?.[key] != null, weatherContext?.sources.forecast ?? null,
      weatherContext?.forecastTimestamp ?? null, 'Weather fact unavailable; no favorable condition assumed.');
  }
  record('weather.venueIndoor', weatherContext?.venue?.indoor != null, weatherContext?.sources.venue ?? null, null, 'Venue indoor/outdoor status unavailable.');
  record('weather.roofOpenClosed', false, weatherContext?.sources.venue ?? null, null, 'NFLWeatherContext does not establish roof open/closed status.');
  for (const field of weatherContext?.missingFields ?? []) {
    record(`weather.missing.${field}`, false, null, weatherContext?.forecastTimestamp ?? null, field);
  }
  const injuryContext = input.injuryContext ?? null;
  record('injury.context', injuryContext !== null && injuryContext.sourceStatus.status === 'CURRENT',
    injuryContext?.sourceStatus.provider ?? null, injuryContext?.lastUpdated ?? null, 'Current injury context unavailable; availability not assumed.');
  for (const field of injuryContext?.missingFields ?? []) record(`injury.missing.${field}`, false,
    injuryContext?.sourceStatus.provider ?? null, injuryContext?.lastUpdated ?? null, field);
  return { recentL3, recentL5, currentSeason, career, opportunity, weatherContext, injuryContext,
    evidence, unavailableEvidence: evidence.filter((entry) => entry.status === 'UNAVAILABLE') };
}