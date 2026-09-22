import type { NBAGameLogEntry } from './types';
import { getNBAHistoricalValue, type NBAAnalyzableMarket } from './market';
import type { NBAInjuryTier } from './injuries';
import {
  mean, median, standardDeviation, unavailableProjection,
  type ProjectionReliability, type ProjectionReliabilityReason, type SportProjection,
} from '../projection/types';

/**
 * NBA projection engine — opportunity-based, never a raw stat average.
 *
 *   projectedStat = projectedRate (per minute) x expectedMinutes
 *
 * Separating rate from minutes is what stops a player's stale 34-minute role from driving a
 * projection when their real recent role is 18 minutes. The rate answers "how productive is this
 * player when on the floor", the minutes answer "how much floor will they get".
 */

/** Minimum games with BOTH a usable stat and usable minutes before any projection is attempted. */
export const NBA_MIN_SAMPLE = 5;
/** Below this, the sample is usable but flagged. */
export const NBA_PREFERRED_SAMPLE = 10;
/** A game shorter than this is treated as a blowout/garbage/DNP-ish outlier for RATE purposes. */
export const NBA_MIN_MINUTES_FOR_RATE = 5;

export type NBARoleSignal =
  | 'ROLE_DECREASE'
  | 'ROLE_INCREASE'
  | 'HIGH_MINUTES_VOLATILITY'
  | 'RECENT_MINUTES_CHANGE'
  | 'INSUFFICIENT_MINUTES_SAMPLE'
  | 'INJURY_STATUS_UNKNOWN'
  | 'INJURY_LISTED';

export interface NBAMinutesEstimate {
  expectedMinutes: number | null;
  minutesUncertainty: number | null;
  minutesReliability: ProjectionReliability;
  reasons: NBARoleSignal[];
  seasonMinutes: number | null;
  recentMinutes: number | null;
  minutesMedian: number | null;
  minutesVolatility: number | null;
  gamesWithMinutes: number;
  /** L3/L20 windows, kept alongside the existing L5/L10/season for evidence display only — they do
   *  not change expectedMinutes or reliability, which remain driven by the L5/L10/season blend above. */
  l3Minutes: number | null;
  l20Minutes: number | null;
  /** Presentational summary of the SAME evidence above (never a second, independent penalty). */
  minutesTrend: NBAMinutesTrend;
}

export type NBAMinutesTrend = 'STABLE_ROLE' | 'ROLE_INCREASE' | 'ROLE_DECREASE' | 'HIGH_MINUTES_VOLATILITY' | 'LOW_RECENT_MINUTES' | 'INSUFFICIENT_MINUTES_DATA';
/** Below this recent-minutes average, a player is in bench-level territory regardless of trend direction. */
const NBA_LOW_MINUTES_THRESHOLD = 15;

interface GameSample { value: number | null; minutes: number | null }

/** Completed games only, oldest→newest, with the market value and minutes for each. */
function sampleGames(logs: NBAGameLogEntry[], market: NBAAnalyzableMarket): GameSample[] {
  return logs
    .filter((log) => log.result != null)
    .map((log) => ({ value: getNBAHistoricalValue(market, log.stats), minutes: log.stats.minutes ?? null }));
}

/**
 * Expected minutes from real minutes history only.
 *
 * FORMULA: a recency-weighted blend, then pulled toward the median when volatility is high.
 *   base = 0.50*L5 + 0.30*L10 + 0.20*season   (over whatever windows exist)
 *   if volatility > 40% of the mean, blend 50/50 with the median to resist one-off outliers.
 *
 * Games with no recorded minutes are EXCLUDED, never counted as zero — a DNP is missing data,
 * not a zero-minute performance.
 *
 * injuryTier deterministic rules (see lib/nba/injuries.ts for the ESPN status normalization):
 *   OUT          -> caller must fail closed before calling this (see projectNBAMarket).
 *   DOUBTFUL     -> reliability capped at LOW; recent-minutes evidence is not trustworthy enough
 *                   to promise a role, even with a large sample.
 *   QUESTIONABLE -> reliability capped at MEDIUM.
 *   ACTIVE       -> no cap from injury status alone; recent-minutes volatility/role signals still
 *                   apply exactly as if status were unknown — active does not imply a stable role.
 *   UNKNOWN      -> adds INJURY_STATUS_UNKNOWN, same as before this task (fails closed to MEDIUM max
 *                   when the sample would otherwise be graded HIGH).
 */
export function estimateExpectedMinutes(logs: NBAGameLogEntry[], injuryTier: NBAInjuryTier = 'UNKNOWN'): NBAMinutesEstimate {
  const minutes = logs.filter((l) => l.result != null).map((l) => l.stats.minutes).filter((m): m is number => m != null && Number.isFinite(m));
  const reasons: NBARoleSignal[] = [];
  const empty: NBAMinutesEstimate = {
    expectedMinutes: null, minutesUncertainty: null, minutesReliability: 'UNRELIABLE',
    reasons: ['INSUFFICIENT_MINUTES_SAMPLE'], seasonMinutes: null, recentMinutes: null,
    minutesMedian: null, minutesVolatility: null, gamesWithMinutes: minutes.length,
    l3Minutes: null, l20Minutes: null, minutesTrend: 'INSUFFICIENT_MINUTES_DATA',
  };
  if (minutes.length < NBA_MIN_SAMPLE) return empty;

  const l5 = minutes.slice(-5);
  const l10 = minutes.slice(-10);
  const seasonMinutes = mean(minutes)!;
  const recentMinutes = mean(l5)!;
  const minutesMedian = median(minutes)!;
  const minutesVolatility = standardDeviation(minutes);

  const parts: Array<[number | null, number]> = [[mean(l5), 0.5], [mean(l10), 0.3], [seasonMinutes, 0.2]];
  const usable = parts.filter(([v]) => v != null) as Array<[number, number]>;
  const weightTotal = usable.reduce((s, [, w]) => s + w, 0);
  let expectedMinutes = usable.reduce((s, [v, w]) => s + v * w, 0) / weightTotal;

  const volatilityRatio = minutesVolatility != null && seasonMinutes > 0 ? minutesVolatility / seasonMinutes : null;
  if (volatilityRatio != null && volatilityRatio > 0.4) {
    reasons.push('HIGH_MINUTES_VOLATILITY');
    expectedMinutes = expectedMinutes * 0.5 + minutesMedian * 0.5;
  }

  // Role change: recent form vs the longer baseline. Named neutrally — we do NOT claim an injury
  // cause unless real injury data supports it.
  const roleDelta = seasonMinutes > 0 ? (recentMinutes - seasonMinutes) / seasonMinutes : 0;
  if (minutes.length >= NBA_PREFERRED_SAMPLE && roleDelta <= -0.25) reasons.push('ROLE_DECREASE');
  else if (minutes.length >= NBA_PREFERRED_SAMPLE && roleDelta >= 0.25) reasons.push('ROLE_INCREASE');
  else if (Math.abs(roleDelta) >= 0.15) reasons.push('RECENT_MINUTES_CHANGE');

  if (minutes.length < NBA_PREFERRED_SAMPLE) reasons.push('INSUFFICIENT_MINUTES_SAMPLE');

  const minutesUncertainty = standardDeviation(l10.length >= 3 ? l10 : minutes);
  const injuryCap: ProjectionReliability | null =
    injuryTier === 'DOUBTFUL' ? 'LOW'
      : injuryTier === 'QUESTIONABLE' ? 'MEDIUM'
        : injuryTier === 'UNKNOWN' ? 'MEDIUM'
          : null; // ACTIVE: no injury-driven cap; recent-minutes signals below still apply.
  const uncappedReliability: ProjectionReliability =
    minutes.length < NBA_MIN_SAMPLE ? 'UNRELIABLE'
      : reasons.includes('ROLE_DECREASE') || reasons.includes('ROLE_INCREASE') ? 'LOW'
        : reasons.includes('HIGH_MINUTES_VOLATILITY') || minutes.length < NBA_PREFERRED_SAMPLE ? 'MEDIUM'
          : 'HIGH';
  const RELIABILITY_RANK: Record<ProjectionReliability, number> = { UNRELIABLE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
  const minutesReliability = injuryCap != null && RELIABILITY_RANK[injuryCap] < RELIABILITY_RANK[uncappedReliability]
    ? injuryCap
    : uncappedReliability;
  if (injuryTier === 'UNKNOWN') reasons.push('INJURY_STATUS_UNKNOWN');
  else if (injuryTier === 'DOUBTFUL' || injuryTier === 'QUESTIONABLE') reasons.push('INJURY_LISTED');

  // Presentational status only — derived from the SAME reasons/values above, never a second
  // independent reliability penalty (avoids double-penalizing the same minutes issue).
  const minutesTrend: NBAMinutesTrend =
    reasons.includes('HIGH_MINUTES_VOLATILITY') ? 'HIGH_MINUTES_VOLATILITY'
      : reasons.includes('ROLE_DECREASE') ? 'ROLE_DECREASE'
        : reasons.includes('ROLE_INCREASE') ? 'ROLE_INCREASE'
          : recentMinutes < NBA_LOW_MINUTES_THRESHOLD ? 'LOW_RECENT_MINUTES'
            : 'STABLE_ROLE';

  return {
    expectedMinutes: Number(expectedMinutes.toFixed(2)),
    minutesUncertainty: minutesUncertainty != null ? Number(minutesUncertainty.toFixed(2)) : null,
    minutesReliability, reasons,
    seasonMinutes: Number(seasonMinutes.toFixed(2)),
    recentMinutes: Number(recentMinutes.toFixed(2)),
    minutesMedian: Number(minutesMedian.toFixed(2)),
    minutesVolatility: minutesVolatility != null ? Number(minutesVolatility.toFixed(2)) : null,
    gamesWithMinutes: minutes.length,
    l3Minutes: mean(minutes.slice(-3)) != null ? Number(mean(minutes.slice(-3))!.toFixed(2)) : null,
    l20Minutes: mean(minutes.slice(-20)) != null ? Number(mean(minutes.slice(-20))!.toFixed(2)) : null,
    minutesTrend,
  };
}

interface RateEstimate { rate: number; rateVolatility: number | null; sampleSize: number }

/**
 * Per-minute rate, recency-weighted across windows that actually exist.
 *   rate = (0.35*L5 + 0.30*L10 + 0.20*L20 + 0.15*season) / sum(weights present)
 * Only games with minutes >= NBA_MIN_MINUTES_FOR_RATE contribute, so a 2-minute cameo cannot
 * produce an absurd per-minute rate.
 */
function estimateRate(samples: GameSample[]): RateEstimate | null {
  const usable = samples.filter((s) => s.value != null && s.minutes != null && s.minutes >= NBA_MIN_MINUTES_FOR_RATE);
  if (usable.length < NBA_MIN_SAMPLE) return null;
  const perGameRates = usable.map((s) => s.value! / s.minutes!);

  const windows: Array<[number[], number]> = [
    [perGameRates.slice(-5), 0.35],
    [perGameRates.slice(-10), 0.30],
    [perGameRates.slice(-20), 0.20],
    [perGameRates, 0.15],
  ];
  const present = windows.filter(([w]) => w.length > 0);
  const weightTotal = present.reduce((s, [, w]) => s + w, 0);
  const rate = present.reduce((s, [w, weight]) => s + mean(w)! * weight, 0) / weightTotal;

  return { rate, rateVolatility: standardDeviation(perGameRates), sampleSize: usable.length };
}

function gradeReliability(reasons: ProjectionReliabilityReason[], sampleSize: number, minutes: NBAMinutesEstimate, injuryTier: NBAInjuryTier): ProjectionReliability {
  const uncapped: ProjectionReliability =
    sampleSize < NBA_MIN_SAMPLE || minutes.minutesReliability === 'UNRELIABLE' ? 'UNRELIABLE'
      : reasons.includes('ROLE_DECREASE') || reasons.includes('ROLE_INCREASE') ? 'LOW'
        : reasons.includes('HIGH_MINUTES_VOLATILITY') || reasons.includes('HIGH_RATE_VOLATILITY') ? 'LOW'
          : sampleSize < NBA_PREFERRED_SAMPLE || reasons.includes('RECENT_MINUTES_CHANGE') || reasons.includes('INJURY_STATUS_UNKNOWN') ? 'MEDIUM'
            : 'HIGH';
  const RANK: Record<ProjectionReliability, number> = { UNRELIABLE: 0, LOW: 1, MEDIUM: 2, HIGH: 3 };
  const cap: ProjectionReliability | null = injuryTier === 'DOUBTFUL' ? 'LOW' : injuryTier === 'QUESTIONABLE' ? 'MEDIUM' : null;
  return cap != null && RANK[cap] < RANK[uncapped] ? cap : uncapped;
}

const DERIVED_COMPONENTS: Partial<Record<NBAAnalyzableMarket, NBAAnalyzableMarket[]>> = {
  pra: ['points', 'rebounds', 'assists'],
  pr: ['points', 'rebounds'],
  pa: ['points', 'assists'],
  ra: ['rebounds', 'assists'],
};

/**
 * Projects one NBA market. Direct markets use rate x minutes; derived markets (PRA/PR/PA) sum their
 * component projections and combine uncertainty using the components' REAL same-game covariance.
 *
 * injuryTier: OUT fails closed immediately — an OUT player cannot qualify for a projection no
 * matter how much history exists. DOUBTFUL/QUESTIONABLE/ACTIVE/UNKNOWN are handled inside
 * estimateExpectedMinutes's reliability grading (see its doc comment for the exact rules).
 */
export function projectNBAMarket(params: {
  logs: NBAGameLogEntry[];
  market: NBAAnalyzableMarket;
  injuryTier?: NBAInjuryTier;
}): SportProjection {
  const { logs, market, injuryTier = 'UNKNOWN' } = params;
  if (injuryTier === 'OUT') return unavailableProjection('nba_rate_x_minutes', ['INJURY_LISTED'], { market });
  const minutes = estimateExpectedMinutes(logs, injuryTier);

  if (market === 'minutes') {
    if (minutes.expectedMinutes == null) return unavailableProjection('nba_minutes', ['INSUFFICIENT_MINUTES_SAMPLE']);
    const reasons = minutes.reasons.filter((r) => r !== 'INSUFFICIENT_MINUTES_SAMPLE') as ProjectionReliabilityReason[];
    return {
      status: 'OK', projection: minutes.expectedMinutes, uncertainty: minutes.minutesUncertainty,
      sampleSize: minutes.gamesWithMinutes, reliability: minutes.minutesReliability, reliabilityReasons: reasons,
      method: 'nba_minutes', inputs: { seasonMinutes: minutes.seasonMinutes, recentMinutes: minutes.recentMinutes },
    };
  }

  const components = DERIVED_COMPONENTS[market];
  if (components) return projectDerived(logs, market, components, minutes, injuryTier);

  if (minutes.expectedMinutes == null) {
    return unavailableProjection('nba_rate_x_minutes', ['INSUFFICIENT_MINUTES_SAMPLE'], { market });
  }
  const samples = sampleGames(logs, market);
  const rateEstimate = estimateRate(samples);
  if (!rateEstimate) {
    const anyValue = samples.some((s) => s.value != null);
    return unavailableProjection('nba_rate_x_minutes', [anyValue ? 'INSUFFICIENT_SAMPLE' : 'MISSING_STAT'], { market });
  }

  const projection = rateEstimate.rate * minutes.expectedMinutes;
  const reasons: ProjectionReliabilityReason[] = [...minutes.reasons];
  if (rateEstimate.sampleSize < NBA_PREFERRED_SAMPLE) reasons.push('SMALL_SAMPLE');
  // Rate volatility is judged relative to the rate itself, so low-rate markets aren't over-flagged.
  const rateCv = rateEstimate.rateVolatility != null && rateEstimate.rate > 0 ? rateEstimate.rateVolatility / rateEstimate.rate : null;
  if (rateCv != null && rateCv > 0.6) reasons.push('HIGH_RATE_VOLATILITY');

  return {
    status: 'OK',
    projection: Number(projection.toFixed(2)),
    uncertainty: combineUncertainty(rateEstimate, minutes),
    sampleSize: rateEstimate.sampleSize,
    reliability: gradeReliability(reasons, rateEstimate.sampleSize, minutes, injuryTier),
    reliabilityReasons: [...new Set(reasons)],
    method: 'nba_rate_x_minutes',
    inputs: {
      market,
      ratePerMinute: Number(rateEstimate.rate.toFixed(4)),
      expectedMinutes: minutes.expectedMinutes,
      seasonMinutes: minutes.seasonMinutes,
      recentMinutes: minutes.recentMinutes,
      minutesVolatility: minutes.minutesVolatility,
      rateVolatility: rateEstimate.rateVolatility != null ? Number(rateEstimate.rateVolatility.toFixed(4)) : null,
    },
  };
}

/**
 * Uncertainty of a product of two uncertain quantities (rate x minutes), via the standard
 * first-order relative-variance approximation:
 *   sd(P)/P ≈ sqrt( (sd(rate)/rate)^2 + (sd(minutes)/minutes)^2 )
 * This is deliberately NOT a simple sum — adding standard deviations would overstate the spread.
 */
function combineUncertainty(rate: RateEstimate, minutes: NBAMinutesEstimate): number | null {
  if (rate.rateVolatility == null || minutes.minutesUncertainty == null) return null;
  if (rate.rate <= 0 || (minutes.expectedMinutes ?? 0) <= 0) return null;
  const rateCv = rate.rateVolatility / rate.rate;
  const minutesCv = minutes.minutesUncertainty / minutes.expectedMinutes!;
  const projection = rate.rate * minutes.expectedMinutes!;
  return Number((projection * Math.sqrt(rateCv ** 2 + minutesCv ** 2)).toFixed(2));
}

/**
 * Derived markets (PRA/PR/PA). Projections sum, but variances do NOT — the components are
 * positively correlated within a game, so:
 *   var(sum) = Σ var(i) + 2 Σ cov(i,j)
 * Covariance is measured from REAL aligned same-game observations. If too few aligned games exist
 * to estimate it, we fall back to the fully-correlated bound (sum of sds), which is the
 * conservative (widest) option, and flag DERIVED_COVARIANCE_UNAVAILABLE.
 */
function projectDerived(
  logs: NBAGameLogEntry[],
  market: NBAAnalyzableMarket,
  components: NBAAnalyzableMarket[],
  minutes: NBAMinutesEstimate,
  injuryTier: NBAInjuryTier,
): SportProjection {
  const parts = components.map((c) => projectNBAMarket({ logs, market: c, injuryTier }));
  if (parts.some((p) => p.status !== 'OK' || p.projection == null)) {
    return unavailableProjection('nba_derived_sum', ['MISSING_COMPONENT'], { market });
  }

  const projection = parts.reduce((s, p) => s + p.projection!, 0);
  const reasons: ProjectionReliabilityReason[] = [...new Set(parts.flatMap((p) => p.reliabilityReasons))];

  const aligned = logs
    .filter((l) => l.result != null)
    .map((l) => components.map((c) => getNBAHistoricalValue(c, l.stats)))
    .filter((vals): vals is number[] => vals.every((v) => v != null));

  let uncertainty: number | null = null;
  if (aligned.length >= NBA_MIN_SAMPLE) {
    const totals = aligned.map((vals) => vals.reduce((s, v) => s + v, 0));
    uncertainty = standardDeviation(totals);
  } else {
    const sds = parts.map((p) => p.uncertainty);
    uncertainty = sds.every((s) => s != null) ? Number(sds.reduce((s, v) => s! + v!, 0)!.toFixed(2)) : null;
    reasons.push('DERIVED_COVARIANCE_UNAVAILABLE');
  }

  const sampleSize = Math.min(...parts.map((p) => p.sampleSize));
  return {
    status: 'OK',
    projection: Number(projection.toFixed(2)),
    uncertainty: uncertainty != null ? Number(uncertainty.toFixed(2)) : null,
    sampleSize,
    reliability: gradeReliability(reasons, sampleSize, minutes, injuryTier),
    reliabilityReasons: reasons,
    method: 'nba_derived_sum',
    inputs: {
      market,
      components: components.join('+'),
      componentProjections: parts.map((p) => p.projection).join(','),
      alignedGames: aligned.length,
      expectedMinutes: minutes.expectedMinutes,
    },
  };
}
