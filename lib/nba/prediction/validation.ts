import { NBA_MODEL_VALIDATION_STATUS, NBA_MODEL_VERSION } from './version';

export interface NBAValidationObservation {
  slateId: string;
  modelVersion: string;
  origin: 'FORWARD_SETTLED' | 'SYNTHETIC_FIXTURE' | 'RECONSTRUCTED';
  predictedAt: string;
  settledAt: string;
  probability: number;
  grade: 'WIN' | 'LOSS' | 'PUSH' | 'VOID' | 'UNGRADABLE';
}

export function evaluateNBAForwardValidation(observations: NBAValidationObservation[]) {
  const genuine = observations.filter((row) => row.modelVersion === NBA_MODEL_VERSION && row.origin === 'FORWARD_SETTLED'
    && (row.grade === 'WIN' || row.grade === 'LOSS')
    && Number.isFinite(Date.parse(row.predictedAt)) && Number.isFinite(Date.parse(row.settledAt))
    && Date.parse(row.predictedAt) < Date.parse(row.settledAt) && Number.isFinite(row.probability) && row.probability > 0 && row.probability < 1)
    .sort((a, b) => Date.parse(a.predictedAt) - Date.parse(b.predictedAt));
  const bySlate = new Map<string, NBAValidationObservation[]>();
  for (const row of genuine) bySlate.set(row.slateId, [...(bySlate.get(row.slateId) ?? []), row]);
  const chronologicalSlates = [...bySlate].sort(([, first], [, second]) => Date.parse(first[0].predictedAt) - Date.parse(second[0].predictedAt));
  const split = Math.floor(chronologicalSlates.length * 0.7);
  const development = chronologicalSlates.slice(0, split).flatMap(([, rows]) => rows);
  const holdout = chronologicalSlates.slice(split).flatMap(([, rows]) => rows);
  const brier = holdout.length ? holdout.reduce((sum, row) => sum + (row.probability - Number(row.grade === 'WIN')) ** 2, 0) / holdout.length : null;
  const logLoss = holdout.length ? holdout.reduce((sum, row) => {
    const probability = Math.max(1e-12, Math.min(1 - 1e-12, row.probability));
    return sum - (row.grade === 'WIN' ? Math.log(probability) : Math.log(1 - probability));
  }, 0) / holdout.length : null;
  return {
    modelVersion: NBA_MODEL_VERSION,
    validationStatus: NBA_MODEL_VALIDATION_STATUS,
    fittingAllowed: false as const,
    eligibleForwardSample: genuine.length,
    chronologicalDevelopmentSample: development.length,
    chronologicalDevelopmentSlates: split,
    chronologicalHoldoutSlates: holdout.length ? chronologicalSlates.length - split : 0,
    chronologicalHoldoutSample: holdout.length,
    brierScore: brier,
    logLoss,
    calibrationBuckets: [0.5, 0.6, 0.7, 0.8, 0.9].map((lower, index, edges) => {
      const upper = edges[index + 1] ?? 1.0000001;
      const bucket = holdout.filter((row) => row.probability >= lower && row.probability < upper);
      return { range: `${Math.round(lower * 100)}-${Math.round(Math.min(upper, 1) * 100)}%`, sampleSize: bucket.length,
        meanProbability: bucket.length ? bucket.reduce((sum, row) => sum + row.probability, 0) / bucket.length : null,
        hitRate: bucket.length ? bucket.filter((row) => row.grade === 'WIN').length / bucket.length : null };
    }),
    claim: 'UNVALIDATED: synthetic and reconstructed rows are excluded; genuine forward outcomes require independent review before calibration claims or fitting.',
  };
}
