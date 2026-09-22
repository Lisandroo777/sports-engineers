import type { ProjectionReliability } from '../projection/types';
import type { NFLRoleRequirement, NFLRoleStatus } from './roleContext';

export interface NFLReliabilityVerdict {
  acceptable: boolean;
  reason: string | null;
}

/**
 * Deterministic NFL Elite reliability policy (Phase 5).
 *
 * Layer ownership (documented to avoid double-penalizing the same fact):
 *   - SportProjection.reliability (lib/nfl/projection.ts) owns "how much should we trust this
 *     NUMBER" — it already folds in sample size, rate volatility, and the role-requirement cap.
 *   - eliteResearchFilter's 'expectedRole' signal owns "do we have real recent role evidence at
 *     all" — an evidence-AVAILABILITY signal, true for STABLE and CHANGING alike, false only when
 *     role status is UNCERTAIN/UNAVAILABLE. It never penalizes CHANGING harder than STABLE.
 *   - trapRisk has no role/workload-specific component today — no third layer double-counts this.
 * This function adds exactly ONE new consequence: whether a LOW/UNRELIABLE projection may still
 * back an official Elite pick, derived from the market's own RoleRequirement — never a second,
 * independent score penalty.
 *
 * Rules:
 *   UNRELIABLE                                          -> never Elite.
 *   HIGH / MEDIUM                                        -> no reliability-driven restriction.
 *   LOW + CRITICAL market + role status not STABLE        -> FAIL (the low trust IS the role instability).
 *   LOW + IMPORTANT market + role status not STABLE       -> FAIL (early-season/uncertain role on a
 *                                                             market that still needs real workload evidence).
 *   LOW + OPTIONAL market, or LOW for a reason unrelated to role (e.g. inherent rare-event rate
 *   volatility on a STABLE-role market) -> allowed; the market itself doesn't lean on role evidence,
 *   or the role evidence was fine and the LOW cause is purely statistical.
 */
export function evaluateNFLReliabilityPolicy(params: {
  reliability: ProjectionReliability | null;
  roleRequirement: NFLRoleRequirement;
  roleStatus: NFLRoleStatus;
}): NFLReliabilityVerdict {
  const { reliability, roleRequirement, roleStatus } = params;

  if (reliability == null || reliability === 'UNRELIABLE') {
    return { acceptable: false, reason: 'Projection reliability is UNRELIABLE — cannot back an Elite pick.' };
  }
  if (reliability === 'HIGH' || reliability === 'MEDIUM') {
    return { acceptable: true, reason: null };
  }

  // reliability === 'LOW'
  if (roleRequirement === 'CRITICAL' && roleStatus !== 'STABLE') {
    return { acceptable: false, reason: `CRITICAL-role market (${roleRequirement}) with LOW reliability and role status ${roleStatus} — the low trust is a real role-instability signal, not noise.` };
  }
  if (roleRequirement === 'IMPORTANT' && roleStatus !== 'STABLE') {
    return { acceptable: false, reason: `IMPORTANT-role market with LOW reliability and role status ${roleStatus} — real opportunity evidence is required before this market can be Elite.` };
  }
  return { acceptable: true, reason: null };
}
