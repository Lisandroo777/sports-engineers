import type { NBAContextModelEvidence, NBAInjuryEvidence, NBAObservedGame } from './types';
import { sampleMean, sampleVariance } from './history';

const MINIMUM_MINUTES_GAMES = 5;
const PREFERRED_MINUTES_GAMES = 10;
const MAX_NBA_MINUTES = 48;

export interface NBAMinutesDistribution {
  mean: number | null;
  uncertainty: number | null;
  sampleSize: number;
  recentMean: number | null;
  seasonMean: number | null;
  roleChange: number | null;
  reliability: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNRELIABLE';
  reasons: string[];
}

export function estimateNBAMinutes(input: {
  observations: NBAObservedGame[];
  injury: NBAInjuryEvidence;
  context?: NBAContextModelEvidence | null;
}): NBAMinutesDistribution {
  const values = input.observations.map(({ log }) => log.stats.minutes).filter((minutes): minutes is number => minutes != null && Number.isFinite(minutes) && minutes > 0 && minutes <= MAX_NBA_MINUTES);
  const recent = values.slice(-5);
  const long = values.slice(-10);
  const seasonMean = sampleMean(values);
  const recentMean = sampleMean(recent);
  const reasons: string[] = [];
  if (values.length < MINIMUM_MINUTES_GAMES) return { mean: null, uncertainty: null, sampleSize: values.length, recentMean, seasonMean, roleChange: null, reliability: 'UNRELIABLE', reasons: ['INSUFFICIENT_MINUTES_SAMPLE'] };
  const roleChange = seasonMean! > 0 ? (recentMean! - seasonMean!) / seasonMean! : null;
  let expected = 0.5 * recentMean! + 0.3 * sampleMean(long)! + 0.2 * seasonMean!;
  const sd = Math.sqrt(sampleVariance(long.length >= 3 ? long : values) ?? 0);
  if (roleChange != null && Math.abs(roleChange) >= 0.2) {
    expected = 0.75 * expected + 0.25 * recentMean!;
    reasons.push(roleChange < 0 ? 'RECENT_ROLE_DECREASE' : 'RECENT_ROLE_INCREASE');
  }
  let uncertainty = Math.max(sd, 1);
  const injuryPenalty: Partial<Record<NBAInjuryEvidence, number>> = {
    FEED_UNAVAILABLE: 0.5, REPORT_MISSING: 0.35, UNKNOWN: 0.5, PROBABLE: 0.12, QUESTIONABLE: 0.3, DOUBTFUL: 0.6, OUT: 1,
    MINUTES_RESTRICTED: 0.5,
  };
  const penalty = injuryPenalty[input.injury] ?? 0;
  if (penalty > 0) {
    uncertainty = Math.sqrt(uncertainty ** 2 + (expected * penalty) ** 2);
    reasons.push(`AVAILABILITY_${input.injury}`);
  }
  if (input.context?.minutesRestricted) {
    uncertainty = Math.sqrt(uncertainty ** 2 + (expected * 0.5) ** 2);
    reasons.push('VERIFIED_MINUTES_RESTRICTION_REQUIRES_REVIEW');
  }
  const reliability = input.injury === 'OUT' ? 'UNRELIABLE'
    : values.length < PREFERRED_MINUTES_GAMES || Math.abs(roleChange ?? 0) >= 0.2 || input.injury === 'FEED_UNAVAILABLE'
      || input.injury === 'UNKNOWN' || input.injury === 'DOUBTFUL' || input.injury === 'MINUTES_RESTRICTED' || input.context?.minutesRestricted ? 'LOW'
      : input.injury === 'QUESTIONABLE' || input.injury === 'PROBABLE' || input.injury === 'REPORT_MISSING' ? 'MEDIUM' : 'HIGH';
  if (input.injury === 'OUT') reasons.push('PLAYER_REPORTED_OUT');
  return { mean: Math.max(0, Math.min(MAX_NBA_MINUTES, expected)), uncertainty, sampleSize: values.length, recentMean, seasonMean, roleChange, reliability, reasons };
}

export interface NBAMarketOpportunity {
  ratePerMinute: number | null;
  rateUncertainty: number | null;
  games: number;
  expectedOpportunity: number | null;
  sources: string[];
  reliability: 'SUPPORTED' | 'PARTIAL' | 'UNAVAILABLE';
}

export function estimateNBAMarketOpportunity(input: {
  marketValues: Array<{ value: number; minutes: number; source: string }>;
  expectedMinutes: number | null;
  contextOpportunity?: number | null;
  contextSource?: string;
}): NBAMarketOpportunity {
  const valid = input.marketValues.filter((entry) => Number.isFinite(entry.value) && entry.value >= 0 && Number.isFinite(entry.minutes) && entry.minutes >= 5);
  if (valid.length < MINIMUM_MINUTES_GAMES) return { ratePerMinute: null, rateUncertainty: null, games: valid.length, expectedOpportunity: null, sources: [], reliability: 'UNAVAILABLE' };
  const rates = valid.map(({ value, minutes }) => value / minutes);
  const windows: Array<[number[], number]> = [[rates.slice(-5), 0.5], [rates.slice(-10), 0.3], [rates.slice(-20), 0.15], [rates, 0.05]];
  const available = windows.filter(([values]) => values.length > 0);
  const totalWeight = available.reduce((sum, [, weight]) => sum + weight, 0);
  const rate = available.reduce((sum, [values, weight]) => sum + sampleMean(values)! * weight, 0) / totalWeight;
  let rateUncertainty = Math.sqrt(sampleVariance(rates) ?? 0);
  const sources = [...new Set(valid.map(({ source }) => source))];
  if (input.contextOpportunity != null && Number.isFinite(input.contextOpportunity) && input.contextOpportunity >= 0 && input.expectedMinutes != null && input.expectedMinutes > 0) {
    const contextRate = input.contextOpportunity / input.expectedMinutes;
    rateUncertainty = Math.sqrt(rateUncertainty ** 2 + (contextRate - rate) ** 2);
    sources.push(input.contextSource ?? 'NBA_RESEARCH_CONTEXT');
    return { ratePerMinute: rate, rateUncertainty, games: valid.length, expectedOpportunity: input.contextOpportunity, sources, reliability: 'SUPPORTED' };
  }
  return { ratePerMinute: rate, rateUncertainty, games: valid.length,
    expectedOpportunity: input.expectedMinutes == null ? null : rate * input.expectedMinutes, sources, reliability: 'PARTIAL' };
}
