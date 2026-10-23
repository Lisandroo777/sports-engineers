// NBA_MODEL_V2_EARLY_SEASON: research-only until NBA_V2_VALIDATION.publishable is true.
export const NBA_V2_MODEL_VERSION = 'NBA_MODEL_V2_EARLY_SEASON';

export interface NBAV2Observation {
  gameId: string;
  date: string;
  minutes: number | null;
  value: number | null;
}

export interface NBAV2Input {
  priorSeason: NBAV2Observation[];
  currentSeason: NBAV2Observation[];
  targetTipoff: string;
  line: number;
}

export interface NBAV2Projection {
  modelVersion: typeof NBA_V2_MODEL_VERSION;
  status: 'AVAILABLE' | 'INSUFFICIENT_PRIOR_SEASON' | 'INVALID_INPUT';
  priorSeasonGames: number;
  currentSeasonGames: number;
  currentSeasonWeight: number | null;
  expectedMinutes: number | null;
  expectedStat: number | null;
  standardDeviation: number | null;
  overProbability: number | null;
  roleShift: number | null;
  uncertaintyMultiplier: number | null;
  reasons: string[];
}

export const NBA_V2_PARAMETERS = Object.freeze({
  minimumPriorGames: 20,
  priorWindow: 40,
  rateShrinkageGames: 10,
  minutesShrinkageGames: 3,
  unstableRoleShift: 0.2,
  minimumMinutes: 5,
});

const usable = (rows: NBAV2Observation[], before: number) => rows
  .filter(row => Date.parse(row.date) < before && row.minutes != null && Number.isFinite(row.minutes)
    && row.minutes >= NBA_V2_PARAMETERS.minimumMinutes && row.value != null && Number.isFinite(row.value))
  .sort((first, second) => Date.parse(first.date) - Date.parse(second.date)) as Array<NBAV2Observation & { minutes: number; value: number }>;
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;

export function projectNBAEarlySeason(input: NBAV2Input): NBAV2Projection {
  const tipoff = Date.parse(input.targetTipoff);
  const empty: NBAV2Projection = { modelVersion: NBA_V2_MODEL_VERSION, status: 'INVALID_INPUT', priorSeasonGames: 0, currentSeasonGames: 0,
    currentSeasonWeight: null, expectedMinutes: null, expectedStat: null, standardDeviation: null, overProbability: null,
    roleShift: null, uncertaintyMultiplier: null, reasons: [] };
  if (!Number.isFinite(tipoff) || !Number.isFinite(input.line)) return { ...empty, reasons: ['Pregame tipoff and line are required.'] };
  // Strictly pregame: anything at or after tipoff is excluded from both seasons.
  const prior = usable(input.priorSeason, tipoff).slice(-NBA_V2_PARAMETERS.priorWindow);
  const current = usable(input.currentSeason, tipoff);
  const labels = { priorSeasonGames: prior.length, currentSeasonGames: current.length };
  if (prior.length < NBA_V2_PARAMETERS.minimumPriorGames) {
    return { ...empty, ...labels, status: 'INSUFFICIENT_PRIOR_SEASON', reasons: [`Prior-season baseline needs ${NBA_V2_PARAMETERS.minimumPriorGames} games with ${NBA_V2_PARAMETERS.minimumMinutes}+ minutes; found ${prior.length}.`] };
  }
  const rate = (rows: typeof prior) => rows.reduce((sum, row) => sum + row.value, 0) / rows.reduce((sum, row) => sum + row.minutes, 0);
  const priorRate = rate(prior);
  const priorMinutes = mean(prior.map(row => row.minutes));
  const n = current.length;
  const rateWeight = n / (n + NBA_V2_PARAMETERS.rateShrinkageGames);
  const minutesWeight = n / (n + NBA_V2_PARAMETERS.minutesShrinkageGames);
  const currentMinutes = n ? mean(current.map(row => row.minutes)) : null;
  const blendedRate = n ? rateWeight * rate(current) + (1 - rateWeight) * priorRate : priorRate;
  const expectedMinutes = currentMinutes == null ? priorMinutes : minutesWeight * currentMinutes + (1 - minutesWeight) * priorMinutes;
  const expectedStat = blendedRate * expectedMinutes;
  const residuals = prior.map(row => row.value - priorRate * row.minutes);
  const priorResidualVariance = mean(residuals.map(value => value ** 2));
  const minutesVariance = mean(prior.map(row => (row.minutes - priorMinutes) ** 2));
  const roleShift = currentMinutes == null ? null : Math.abs(currentMinutes - priorMinutes) / Math.max(priorMinutes, 1);
  const reasons = ['Prior-season games are a labeled baseline, not current-season evidence.'];
  let multiplier = 1 + 0.5 / (n + 1);
  if (roleShift != null && roleShift > NBA_V2_PARAMETERS.unstableRoleShift) {
    multiplier += 0.5;
    reasons.push(`Unstable role: current minutes differ ${(roleShift * 100).toFixed(0)}% from the prior-season baseline.`);
  }
  if (n < 3) reasons.push(`Only ${n} current-season game(s); uncertainty inflated.`);
  const variance = (priorResidualVariance + blendedRate ** 2 * minutesVariance) * multiplier;
  const standardDeviation = Math.max(0.5, Math.sqrt(variance));
  // Counting stats are right-skewed; scale the player's own prior-season deviations instead of assuming symmetry.
  const priorMean = mean(prior.map(row => row.value));
  const scale = priorMean > 0 ? expectedStat / priorMean : 1;
  const scenarios = prior.map(row => expectedStat + Math.sqrt(multiplier) * (row.value - priorMean) * scale);
  const overProbability = (scenarios.filter(value => value > input.line).length + 0.5) / (scenarios.length + 1);
  return { modelVersion: NBA_V2_MODEL_VERSION, status: 'AVAILABLE', ...labels, currentSeasonWeight: rateWeight,
    expectedMinutes, expectedStat, standardDeviation, overProbability: Math.min(0.99, Math.max(0.01, overProbability)),
    roleShift, uncertaintyMultiplier: multiplier, reasons };
}
