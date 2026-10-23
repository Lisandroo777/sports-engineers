// NBA V2.1 development-only evaluation (2024-25). Never reads the examined 2025-26 holdout.
// Usage: node scripts/nba-v2_1/develop.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildCandidates } from './data.mjs';

const SEASON = 2025;
const MIN_EV = 3;
const BOUNDS = [0.1, 0.9];
const logit = p => Math.log(Math.min(0.995, Math.max(0.005, p)) / (1 - Math.min(0.995, Math.max(0.005, p))));
const sigmoid = x => 1 / (1 + Math.exp(-x));
const profit = price => price > 0 ? price / 100 : 100 / -price;

/** Per-market logistic calibration on [1, logit(V2), logit(no-vig market)] with light L2, fit by Newton steps. */
export function fitCalibration(rows) {
  const byMarket = {};
  for (const market of ['points', 'rebounds', 'assists']) {
    const data = rows.filter(row => row.market === market && row.outcomeOver != null);
    let w = [0, 1, 0];
    for (let step = 0; step < 25; step += 1) {
      const g = [0, 0, 0]; const h = [[1e-3, 0, 0], [0, 1e-3, 0], [0, 0, 1e-3]];
      for (const row of data) {
        const x = [1, logit(row.pOver), logit(row.noVigOver)];
        const p = sigmoid(w[0] * x[0] + w[1] * x[1] + w[2] * x[2]);
        for (let i = 0; i < 3; i += 1) { g[i] += (p - row.outcomeOver) * x[i]; for (let j = 0; j < 3; j += 1) h[i][j] += p * (1 - p) * x[i] * x[j]; }
      }
      w = w.map((value, i) => value - solve(h, g)[i]);
    }
    byMarket[market] = { intercept: w[0], v2Weight: w[1], marketWeight: w[2], trainingRows: data.length };
  }
  return byMarket;
}
function solve(a, b) {
  const m = a.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < 3; i += 1) {
    const pivot = m[i][i];
    for (let j = i; j < 4; j += 1) m[i][j] /= pivot;
    for (let k = 0; k < 3; k += 1) if (k !== i) { const f = m[k][i]; for (let j = i; j < 4; j += 1) m[k][j] -= f * m[i][j]; }
  }
  return m.map(row => row[3]);
}
const calibrated = (coefficients, row) => { const c = coefficients[row.market];
  return sigmoid(c.intercept + c.v2Weight * logit(row.pOver) + c.marketWeight * logit(row.noVigOver)); };

function calibrationTable(rows, key) {
  const bins = Array.from({ length: 10 }, (_, index) => ({ range: `${index * 10}-${index * 10 + 10}%`, count: 0, predicted: 0, observed: 0 }));
  for (const row of rows) { const bin = bins[Math.min(9, Math.floor(row[key] * 10))]; bin.count += 1; bin.predicted += row[key]; bin.observed += row.outcomeOver; }
  const ece = rows.length ? bins.reduce((sum, bin) => sum + Math.abs(bin.predicted - bin.observed), 0) / rows.length : null;
  return { ece, bins: bins.filter(bin => bin.count).map(bin => ({ range: bin.range, count: bin.count, predicted: +(bin.predicted / bin.count).toFixed(3), observed: +(bin.observed / bin.count).toFixed(3) })) };
}
const brier = (rows, key) => rows.reduce((sum, row) => sum + (row[key] - row.outcomeOver) ** 2, 0) / rows.length;

function selectBets(rows, key, mode) {
  const best = new Map();
  for (const row of rows) for (const side of ['over', 'under']) {
    const p = side === 'over' ? row[key] : 1 - row[key];
    const price = row[side]; const ev = (p * profit(price) - (1 - p)) * 100;
    if (ev < MIN_EV || p < BOUNDS[0] || p > BOUNDS[1]) continue;
    if (mode !== 'BEST_PRICE' && row.book !== mode) continue;
    const id = `${row.gameId}|${row.playerId}|${row.market}`;
    const result = row.actual === row.line ? 0 : (side === 'over') === (row.actual > row.line) ? profit(price) : -1;
    if (!best.has(id) || best.get(id).ev < ev) best.set(id, { ...row, side, ev, result, push: row.actual === row.line });
  }
  return [...best.values()];
}
function roiSummary(bets) {
  if (!bets.length) return { bets: 0 };
  const roi = rows => rows.reduce((sum, bet) => sum + bet.result, 0) / rows.length;
  const games = new Map(); for (const bet of bets) games.set(bet.gameId, [...(games.get(bet.gameId) ?? []), bet]);
  const clusters = [...games.values()]; const samples = [];
  let seed = 7; const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let index = 0; index < 4000; index += 1) samples.push(roi(Array.from({ length: clusters.length }, () => clusters[Math.floor(random() * clusters.length)]).flat()));
  samples.sort((a, b) => a - b);
  return { bets: bets.length, pushes: bets.filter(bet => bet.push).length, roi: +roi(bets).toFixed(4),
    roi95: [+samples[Math.floor(samples.length * 0.025)].toFixed(4), +samples[Math.floor(samples.length * 0.975)].toFixed(4)],
    meanClaimedEv: +(bets.reduce((sum, bet) => sum + bet.ev, 0) / bets.length).toFixed(2) };
}

function evaluateSplit(name, train, test) {
  const coefficients = fitCalibration(train);
  for (const row of test) row.pV21 = calibrated(coefficients, row);
  const settled = test.filter(row => row.outcomeOver != null);
  const byMarket = Object.fromEntries(['points', 'rebounds', 'assists'].map(market => {
    const rows = settled.filter(row => row.market === market);
    return [market, { rows: rows.length, eceV2: +calibrationTable(rows, 'pOver').ece.toFixed(4), eceV21: +calibrationTable(rows, 'pV21').ece.toFixed(4),
      brierV2: +brier(rows, 'pOver').toFixed(4), brierV21: +brier(rows, 'pV21').toFixed(4), brierMarket: +brier(rows, 'noVigOver').toFixed(4),
      roiV21: roiSummary(selectBets(rows, 'pV21', 'BEST_PRICE')) }];
  }));
  const books = [...new Set(test.map(row => row.book))];
  return { split: name, trainRows: train.length, testRows: test.length, coefficients,
    calibrationV2: calibrationTable(settled, 'pOver'), calibrationV21: calibrationTable(settled, 'pV21'),
    brier: { v2: +brier(settled, 'pOver').toFixed(4), v21: +brier(settled, 'pV21').toFixed(4), market: +brier(settled, 'noVigOver').toFixed(4) },
    byMarket,
    roi: { v2BestPrice: roiSummary(selectBets(test, 'pOver', 'BEST_PRICE')), v21BestPrice: roiSummary(selectBets(test, 'pV21', 'BEST_PRICE')),
      v21SingleBook: Object.fromEntries(books.map(book => [book, roiSummary(selectBets(test, 'pV21', book))])) } };
}

const { audit, candidates } = await buildCandidates(SEASON);
for (const row of candidates) row.outcomeOver = row.actual > row.line ? 1 : row.actual < row.line ? 0 : null;
const dates = [...new Set(candidates.map(row => row.tipoff.slice(0, 10)))].sort();
const cut = dates[Math.floor(dates.length / 2)];
const splits = [
  evaluateSplit(`time-ordered: train < ${cut}, test >= ${cut}`, candidates.filter(row => row.tipoff.slice(0, 10) < cut), candidates.filter(row => row.tipoff.slice(0, 10) >= cut)),
  evaluateSplit('player-separated: train even ESPN IDs, test odd', candidates.filter(row => row.playerId % 2 === 0), candidates.filter(row => row.playerId % 2 === 1)),
];
const final = fitCalibration(candidates.filter(row => row.outcomeOver != null));
const audits = { ...audit, unmatchedPlayers: Object.entries(audit.unmatchedPlayers).sort((a, b) => b[1] - a[1]).slice(0, 15),
  candidates: candidates.length, integerLinePushRate: +(candidates.filter(row => row.outcomeOver == null).length / candidates.length).toFixed(4),
  lowMinuteSettled: candidates.filter(row => row.minutes > 0 && row.minutes < 5).length,
  linesPerPlayerMarketGame: +(candidates.length / new Set(candidates.map(row => `${row.gameId}|${row.playerId}|${row.market}`)).size).toFixed(2) };
mkdirSync('reports/nba-v2_1', { recursive: true });
const report = { modelVersion: 'NBA_MODEL_V2_1_EARLY_SEASON_CALIBRATED', season: '2024-25', role: 'DEVELOPMENT_ONLY', holdout2025_26Used: false,
  generatedAt: new Date().toISOString(), selectionRule: { minEvPercent: MIN_EV, probabilityBounds: BOUNDS }, audits, splits, finalCoefficients: final, publishable: false };
writeFileSync('reports/nba-v2_1/development.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ audits, splits: splits.map(split => ({ split: split.split, eceV2: +split.calibrationV2.ece.toFixed(4), eceV21: +split.calibrationV21.ece.toFixed(4),
  brier: split.brier, byMarket: Object.fromEntries(Object.entries(split.byMarket).map(([k, v]) => [k, { eceV2: v.eceV2, eceV21: v.eceV21, roiV21: v.roiV21.roi, bets: v.roiV21.bets }])),
  roiV2Best: split.roi.v2BestPrice, roiV21Best: split.roi.v21BestPrice,
  roiV21SingleBook: Object.fromEntries(Object.entries(split.roi.v21SingleBook).map(([k, v]) => [k, [v.bets, v.roi, v.roi95]])) })), finalCoefficients: final }, null, 1));
