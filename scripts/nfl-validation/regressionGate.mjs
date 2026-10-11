export function compareModelReports(accepted, candidate) {
  const reasons = [];
  if (!accepted || !candidate) return { decision: 'BLOCKED', reasons: ['Two outcome evaluation reports required; no accepted predictive reference yet.'] };
  const baseline = accepted.excludingQuestionableQuotes?.overall;
  const challenger = candidate.excludingQuestionableQuotes?.overall;
  if (!baseline || !challenger || baseline.probability.n < 500 || challenger.probability.n < 500) reasons.push('Insufficient settled sample: at least 500 paired binary outcomes per report');
  if (accepted.cohortHash !== candidate.cohortHash) reasons.push('Cohort mismatch: compare exact same evaluation IDs, never a selected favorable subset');
  if (candidate.datasetQuality.finalClean < accepted.datasetQuality.finalClean) reasons.push('Reduced clean prediction coverage');
  const checks = [['projection.mae', 0.02], ['probability.brier', 0.01], ['probability.logLoss', 0.01], ['probability.ece', 0.005]];
  for (const [path, tolerance] of checks) {
    const read = (object) => path.split('.').reduce((value, key) => value?.[key], object);
    const previous = read(baseline);
    const next = read(challenger);
    if (!Number.isFinite(previous) || !Number.isFinite(next)) reasons.push(`Missing ${path}`);
    else if (path === 'projection.mae' ? next > previous * (1 + tolerance) : next > previous + tolerance) reasons.push(`Regression in ${path}`);
  }
  for (const mode of ['BEST', 'MOST_LIKELY', 'BEST_VALUE']) {
    const previous = accepted.excludingQuestionableQuotes?.ranking?.modes?.[mode]?.TOP_3;
    const next = candidate.excludingQuestionableQuotes?.ranking?.modes?.[mode]?.TOP_3;
    if (!previous || !next || previous.probability.n < 100 || next.probability.n < 100) reasons.push(`Insufficient ${mode} ranking evidence`);
    else if (next.probability.brier > previous.probability.brier + 0.01 || next.hitRate < previous.hitRate - 0.02
      || mode === 'BEST_VALUE' && next.bankroll.roi < previous.bankroll.roi - 0.02) reasons.push(`Regression in ${mode} ranking performance`);
  }
  return { decision: reasons.length ? 'BLOCKED' : 'REQUIRES_REVIEW', reasons,
    policy: 'Never auto-accept or deploy. Fixed conservative warning tolerances are governance diagnostics, not significance tests; inspect paired/cluster uncertainty, market failures, sample and ROI before approval.' };
}