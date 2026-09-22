/**
 * Cross-sport projection contract.
 *
 * Every sport computes projections its own way (NBA uses rate x minutes, NFL uses a short-season
 * historical baseline), but all of them report the result in this shape so downstream consumers —
 * the Elite Filter, probability model and Finder — never need sport-specific branching.
 *
 * The contract exists to make projection TRUST explicit. A number alone is not enough: callers must
 * be able to see how reliable it is and why, and an UNRELIABLE projection must never back an
 * official Elite candidate.
 */

/**
 * HIGH       – large sample, stable role, low volatility.
 * MEDIUM     – usable, with a named caveat (moderate sample or volatility).
 * LOW        – real data but a material trust problem; not Elite-eligible.
 * UNRELIABLE – critical context missing or contradictory; must fail closed.
 */
export type ProjectionReliability = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNRELIABLE';

/** Machine-readable reasons behind a reliability grade. Never free text, so callers can branch. */
export type ProjectionReliabilityReason =
  | 'INSUFFICIENT_SAMPLE'
  | 'SMALL_SAMPLE'
  | 'INSUFFICIENT_MINUTES_SAMPLE'
  | 'HIGH_MINUTES_VOLATILITY'
  | 'HIGH_RATE_VOLATILITY'
  | 'ROLE_DECREASE'
  | 'ROLE_INCREASE'
  | 'RECENT_MINUTES_CHANGE'
  | 'INJURY_STATUS_UNKNOWN'
  | 'INJURY_LISTED'
  | 'MISSING_COMPONENT'
  | 'MISSING_STAT'
  | 'DERIVED_COVARIANCE_UNAVAILABLE'
  | 'ROLE_CONTEXT_UNAVAILABLE'
  | 'SHORT_SEASON_SAMPLE';

export type ProjectionStatus = 'OK' | 'UNAVAILABLE';

/** What a sport's projection engine returns for one player+market. */
export interface SportProjection {
  status: ProjectionStatus;
  /** Expected value of the stat. Null whenever status is UNAVAILABLE — never a fabricated 0. */
  projection: number | null;
  /** Standard-deviation-style spread of the projection. Null when it cannot be estimated. */
  uncertainty: number | null;
  /** Games that actually contributed to the estimate (not games requested). */
  sampleSize: number;
  reliability: ProjectionReliability;
  reliabilityReasons: ProjectionReliabilityReason[];
  /** Short identifier of the formula used, e.g. 'nba_rate_x_minutes'. */
  method: string;
  /** Sport-specific intermediate values, surfaced for auditability. Never used for qualification. */
  inputs: Record<string, number | string | null>;
}

export function unavailableProjection(method: string, reasons: ProjectionReliabilityReason[], inputs: SportProjection['inputs'] = {}): SportProjection {
  return { status: 'UNAVAILABLE', projection: null, uncertainty: null, sampleSize: 0, reliability: 'UNRELIABLE', reliabilityReasons: reasons, method, inputs };
}

/** Only HIGH/MEDIUM projections may back an official Elite candidate. */
export function isEliteEligibleProjection(projection: SportProjection): boolean {
  return projection.status === 'OK' && (projection.reliability === 'HIGH' || projection.reliability === 'MEDIUM');
}

export function mean(values: number[]): number | null {
  return values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
}

export function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - m) ** 2, 0) / (values.length - 1));
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
