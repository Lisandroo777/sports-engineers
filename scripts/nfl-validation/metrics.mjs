export const mean = (values) => values.length ? values.reduce((total, value) => total + value, 0) / values.length : null;
export function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
export function sampleLabel(count) {
  return count < 30 ? 'VERY_SMALL_SAMPLE' : count < 100 ? 'SMALL_SAMPLE' : count < 500 ? 'MODERATE_SAMPLE' : 'STRONGER_SAMPLE';
}
export function implied(odds) {
  if (!Number.isFinite(odds) || Math.abs(odds) < 100) return null;
  return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100);
}
export function decimalProfit(odds) {
  return implied(odds) == null ? null : odds > 0 ? odds / 100 : 100 / -odds;
}
export function wilson(wins, count) {
  if (!count) return null;
  const zScore = 1.959963984540054;
  const proportion = wins / count;
  const denominator = 1 + zScore ** 2 / count;
  const center = (proportion + zScore ** 2 / (2 * count)) / denominator;
  const half = zScore * Math.sqrt(proportion * (1 - proportion) / count + zScore ** 2 / (4 * count ** 2)) / denominator;
  return { low: Math.max(0, center - half), high: Math.min(1, center + half), method: 'Wilson 95%; assumes independent Bernoulli trials. Same-game correlations limit interpretation.' };
}
export function projectionMetrics(rows, key = 'projection') {
  const usable = rows.filter((row) => Number.isFinite(row[key]) && Number.isFinite(row.outcome.actual)
    && row.outcome.participated === true && ['WIN', 'LOSS', 'PUSH'].includes(row.settlement));
  const errors = usable.map((row) => row.outcome.actual - row[key]);
  return { n: errors.length, sample: sampleLabel(errors.length), mae: mean(errors.map(Math.abs)),
    rmse: errors.length ? Math.sqrt(mean(errors.map((error) => error ** 2))) : null,
    medianAbsoluteError: median(errors.map(Math.abs)), biasActualMinusProjection: mean(errors),
    residualQuantiles: errors.length ? Object.fromEntries([0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map((quantile) => {
      const sorted = [...errors].sort((first, second) => first - second);
      return [quantile, sorted[Math.floor(quantile * (sorted.length - 1))]];
    })) : null };
}
const PROBABILITY_BUCKETS = [[0, 0.5], [0.5, 0.55], [0.55, 0.6], [0.6, 0.65], [0.65, 0.7],
  [0.7, 0.75], [0.75, 0.8], [0.8, 0.85], [0.85, 0.9], [0.9, 0.95], [0.95, 1.000001]];
export function probabilityMetrics(rows, key = 'probability') {
  const usable = rows.filter((row) => ['WIN', 'LOSS'].includes(row.settlement) && Number.isFinite(row[key]) && row[key] >= 0 && row[key] <= 1);
  const tables = PROBABILITY_BUCKETS.map(([low, high]) => {
    const bucket = usable.filter((row) => row[key] >= low && row[key] < high);
    const wins = bucket.filter((row) => row.settlement === 'WIN').length;
    const predicted = mean(bucket.map((row) => row[key]));
    const observed = bucket.length ? wins / bucket.length : null;
    return { low, high: Math.min(high, 1), n: bucket.length, sample: sampleLabel(bucket.length), averagePredicted: predicted,
      hitRate: observed, actualMinusPredicted: observed == null ? null : observed - predicted, confidenceInterval: wilson(wins, bucket.length) };
  });
  const occupied = tables.filter((bucket) => bucket.n);
  return { n: usable.length, sample: sampleLabel(usable.length),
    brier: mean(usable.map((row) => (row[key] - Number(row.settlement === 'WIN')) ** 2)),
    logLoss: mean(usable.map((row) => {
      const probability = Math.max(1e-12, Math.min(1 - 1e-12, row[key]));
      return row.settlement === 'WIN' ? -Math.log(probability) : -Math.log(1 - probability);
    })),
    ece: usable.length ? occupied.reduce((total, bucket) => total + Math.abs(bucket.actualMinusPredicted) * bucket.n / usable.length, 0) : null,
    mce: occupied.length ? Math.max(...occupied.map((bucket) => Math.abs(bucket.actualMinusPredicted))) : null,
    buckets: tables, pushPolicy: 'PUSH excluded from binary calibration; no wins inferred. Interpret as non-push diagnostic, not a validated unconditional probability.' };
}
export function bankroll(rows) {
  const settled = rows.filter((row) => ['WIN', 'LOSS', 'PUSH'].includes(row.settlement) && decimalProfit(row.odds) != null)
    .sort((first, second) => Date.parse(first.predictionAt) - Date.parse(second.predictionAt) || first.id.localeCompare(second.id));
  let equity = 0;
  let peak = 0;
  let drawdown = 0;
  let lossStreak = 0;
  let winStreak = 0;
  let longestLoss = 0;
  let longestWin = 0;
  for (const row of settled) {
    const units = row.settlement === 'WIN' ? decimalProfit(row.odds) : row.settlement === 'LOSS' ? -1 : 0;
    equity += units;
    peak = Math.max(peak, equity);
    drawdown = Math.max(drawdown, peak - equity);
    if (row.settlement === 'LOSS') { lossStreak++; winStreak = 0; }
    if (row.settlement === 'WIN') { winStreak++; lossStreak = 0; }
    longestLoss = Math.max(longestLoss, lossStreak);
    longestWin = Math.max(longestWin, winStreak);
  }
  const decisions = settled.filter((row) => row.settlement !== 'PUSH');
  return { n: settled.length, wins: settled.filter((row) => row.settlement === 'WIN').length,
    losses: settled.filter((row) => row.settlement === 'LOSS').length, pushes: settled.filter((row) => row.settlement === 'PUSH').length,
    units: settled.length ? equity : null, roi: decisions.length ? equity / decisions.length : null,
    maxDrawdown: settled.length ? drawdown : null, longestLosingStreak: settled.length ? longestLoss : null,
    longestWinningStreak: settled.length ? longestWin : null,
    policy: 'One unit flat; pushes refund stake and are excluded from ROI turnover. Voids/DNP/unresolved excluded. Same-timestamp ties ordered by ID; drawdown is diagnostic.' };
}
export function summary(rows) {
  const decisions = rows.filter((row) => ['WIN', 'LOSS'].includes(row.settlement));
  const wins = decisions.filter((row) => row.settlement === 'WIN').length;
  return { n: rows.length, uniqueGames: new Set(rows.map((row) => row.gameId)).size, sample: sampleLabel(decisions.length),
    wins, losses: decisions.length - wins, pushes: rows.filter((row) => row.settlement === 'PUSH').length,
    voids: rows.filter((row) => row.settlement === 'VOID').length, dnp: rows.filter((row) => row.settlement === 'DNP').length,
    unresolved: rows.filter((row) => row.settlement === 'UNRESOLVED').length,
    hitRate: decisions.length ? wins / decisions.length : null, hitRateInterval: wilson(wins, decisions.length),
    averagePredictedProbability: mean(decisions.map((row) => row.probability).filter(Number.isFinite)),
    averageImpliedProbability: mean(decisions.map((row) => row.rawImpliedProbability).filter(Number.isFinite)),
    averagePriceEdgePP: mean(decisions.map((row) => row.edgePP).filter(Number.isFinite)),
    averageEstimatedEV: mean(decisions.map((row) => row.ev).filter(Number.isFinite)),
    probability: probabilityMetrics(rows), projection: projectionMetrics(rows), bankroll: bankroll(rows) };
}
export function grouped(rows, groupBy, expectedKeys = []) {
  const keys = [...new Set([...expectedKeys, ...rows.map(groupBy)])].sort();
  return Object.fromEntries(keys.map((key) => [key, summary(rows.filter((row) => groupBy(row) === key))]));
}