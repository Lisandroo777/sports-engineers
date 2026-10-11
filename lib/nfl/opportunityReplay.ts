import { NFL_OPPORTUNITY_BLEND_WEIGHT } from './opportunityProjection';
import type { NFLMarketHistory } from './history';
import type { NFLOpportunityTrend } from './roleContext';

export function auditNFLSavedOpportunity(params: {
  history: NFLMarketHistory;
  opportunity: NFLOpportunityTrend;
  historicalBaseline: number;
}) {
  const { history, opportunity, historicalBaseline } = params;
  const observations = history.observations;
  if (['player_pass_yds', 'player_rush_yds', 'player_reception_yds'].includes(history.market)
    && observations.some((entry) => entry.value != null && Number.isFinite(entry.value) && entry.value < 0)) {
    return { status: 'BLOCKED' as const, reason: 'A negative yardage outcome is present but its per-game opportunity pair was not retained; aggregate replay cannot verify this efficiency input.' };
  }
  const current = observations.filter((entry) => entry.source === 'CURRENT_SEASON');
  const prior = observations.filter((entry) => entry.source === 'PREVIOUS_SEASON');
  const latest5 = observations.slice(-5);
  const latest3 = observations.slice(-3);
  const complete = observations.every((entry) => entry.value != null && Number.isFinite(entry.value)
    && entry.weight === (entry.source === 'CURRENT_SEASON' ? 1 : 0.6));
  const matching = complete && observations.length === opportunity.rolling?.games && observations.length === opportunity.l10.games
    && current.length === opportunity.season.games && current.length >= 3 && current.length < 6
    && latest5.length === opportunity.l5.games && latest3.length === opportunity.l3.games
    && latest3.every((entry) => entry.source === 'CURRENT_SEASON')
    && latest5.filter((entry) => entry.source === 'CURRENT_SEASON').length === current.length
    && opportunity.season.mean != null && opportunity.rolling?.mean != null && opportunity.l5.mean != null && opportunity.l3.mean != null;
  if (!matching) return { status: 'BLOCKED' as const, reason: 'Saved aggregate windows cannot establish a complete matching early-season opportunity sample.' };
  const currentSum = opportunity.season.mean! * current.length;
  const weightTotal = current.length + prior.length * 0.6;
  // roleContext windows are unweighted arithmetic means (roleContext.ts window()); recover
  // the unweighted all-game sum, then apply the production historySample prior weight once.
  const rollingSum = opportunity.rolling!.mean! * observations.length;
  const weightedOpportunitySum = currentSum + (rollingSum - currentSum) * 0.6;
  const rollingMean = weightedOpportunitySum / weightTotal;
  const last5Sum = opportunity.l5.mean! * latest5.length;
  // L5 is also an unweighted window. Its prior rows are the only rows receiving 0.6 here.
  const last5Mean = (currentSum + (last5Sum - currentSum) * 0.6) / (current.length + (latest5.length - current.length) * 0.6);
  if (weightedOpportunitySum <= 0) return { status: 'BLOCKED' as const, reason: 'Saved opportunity totals are zero or invalid.' };
  const expectedOpportunity = 0.45 * opportunity.l3.mean! + 0.35 * last5Mean + 0.20 * rollingMean;
  const weightedProduction = observations.reduce((sum, entry) => sum + entry.value! * entry.weight, 0);
  const efficiency = weightedProduction / weightedOpportunitySum;
  const opportunityProjection = expectedOpportunity * efficiency;
  return {
    status: 'AGGREGATE_AUDIT_ONLY' as const,
    expectedOpportunity, efficiency, opportunityProjection, historicalBaseline,
    finalProjection: (1 - NFL_OPPORTUNITY_BLEND_WEIGHT) * historicalBaseline + NFL_OPPORTUNITY_BLEND_WEIGHT * opportunityProjection,
    reason: 'Saved means/counts support aggregate algebra only; original paired opportunities are expired. No per-game targets are reconstructed, and production replay or corrected probability/tier is not asserted.',
  };
}