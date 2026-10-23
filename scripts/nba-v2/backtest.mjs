// Leakage-safe NBA V2 early-season calibration backtest using free ESPN game logs. Run: node scripts/nba-v2/backtest.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { projectNBAEarlySeason, NBA_V2_MODEL_VERSION, NBA_V2_PARAMETERS } from '../../lib/nba/prediction/v2/earlySeason.ts';

const TARGET_SEASON = 2026; // ESPN season=2026 is 2025-26
const PRIOR_SEASON = 2025;
const EARLY_GAMES = 10;
const MARKETS = { points: 'points', rebounds: 'totalRebounds', assists: 'assists' };
const GATE = { minimumPredictions: 1500, maximumCalibrationError: 0.03 };

async function json(url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { headers: { accept: 'application/json' } }).catch(() => null);
    if (response?.ok) return response.json();
    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
  }
  return null;
}

async function regularSeason(playerId, season) {
  const data = await json(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${playerId}/gamelog?season=${season}`);
  if (!data) return null;
  const names = data.names ?? [];
  const rows = [];
  for (const type of data.seasonTypes ?? []) {
    if (!/regular season/i.test(type.displayName ?? '')) continue;
    for (const category of type.categories ?? []) for (const event of category.events ?? []) {
      const date = data.events?.[event.eventId]?.gameDate;
      if (!date) continue;
      const stat = Object.fromEntries(names.map((name, index) => [name, Number(event.stats?.[index])]));
      rows.push({ gameId: event.eventId, date, stat });
    }
  }
  return [...new Map(rows.map(row => [row.gameId, row])).values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

async function pool(items, size, worker) {
  const results = [];
  let index = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (index < items.length) { const item = items[index++]; results.push(await worker(item)); } }));
  return results;
}

const teams = (await json('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams'))?.sports?.[0]?.leagues?.[0]?.teams?.map(entry => entry.team.id) ?? [];
const playerIds = new Set();
for (const teamId of teams) {
  const roster = await json(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${teamId}/roster`);
  for (const athlete of roster?.athletes ?? []) playerIds.add(athlete.id);
}

const predictions = [];
let leakageViolations = 0;
await pool([...playerIds], 6, async playerId => {
  const [target, prior] = await Promise.all([regularSeason(playerId, TARGET_SEASON), regularSeason(playerId, PRIOR_SEASON)]);
  if (!target?.length || !prior?.length) return;
  for (const [index, game] of target.slice(0, EARLY_GAMES).entries()) {
    if (!(game.stat.minutes >= NBA_V2_PARAMETERS.minimumMinutes)) continue;
    for (const [market, key] of Object.entries(MARKETS)) {
      const toObservation = row => ({ gameId: row.gameId, date: row.date, minutes: row.stat.minutes, value: row.stat[key] });
      const priorRows = prior.map(toObservation);
      const currentRows = target.slice(0, index).map(toObservation);
      if ([...priorRows, ...currentRows].some(row => Date.parse(row.date) >= Date.parse(game.date))) leakageViolations += 1;
      const recent = priorRows.filter(row => row.minutes >= NBA_V2_PARAMETERS.minimumMinutes).slice(-NBA_V2_PARAMETERS.priorWindow);
      if (recent.length < NBA_V2_PARAMETERS.minimumPriorGames) continue;
      // Reference line uses only prior-season data, so it is fixed before the target game.
      const line = Math.floor(recent.reduce((sum, row) => sum + row.value, 0) / recent.length) + 0.5;
      const projection = projectNBAEarlySeason({ priorSeason: priorRows, currentSeason: currentRows, targetTipoff: game.date, line });
      if (projection.status !== 'AVAILABLE') continue;
      const baselineOver = (recent.filter(row => row.value > line).length + 1) / (recent.length + 2);
      predictions.push({ market, gameIndex: index, holdout: Number(playerId) % 2 === 1, probability: projection.overProbability, baseline: baselineOver,
        outcome: game.stat[key] > line ? 1 : 0, error: Math.abs(projection.expectedStat - game.stat[key]) });
    }
  }
});

function evaluate(predictions) {
const brier = key => predictions.reduce((sum, row) => sum + (row[key] - row.outcome) ** 2, 0) / predictions.length;
const logLoss = key => -predictions.reduce((sum, row) => sum + (row.outcome ? Math.log(row[key]) : Math.log(1 - row[key])), 0) / predictions.length;
const bins = Array.from({ length: 10 }, (_, bin) => {
  const rows = predictions.filter(row => Math.min(9, Math.floor(row.probability * 10)) === bin);
  return { bin: `${bin * 10}-${bin * 10 + 10}%`, count: rows.length,
    predicted: rows.length ? rows.reduce((sum, row) => sum + row.probability, 0) / rows.length : null,
    observed: rows.length ? rows.reduce((sum, row) => sum + row.outcome, 0) / rows.length : null };
});
const calibrationError = bins.reduce((sum, bin) => sum + (bin.count ? bin.count * Math.abs(bin.predicted - bin.observed) : 0), 0) / predictions.length;
const metrics = { predictions: predictions.length, players: playerIds.size, leakageViolations,
  brier: brier('probability'), baselineBrier: brier('baseline'), logLoss: logLoss('probability'), baselineLogLoss: logLoss('baseline'),
  expectedCalibrationError: calibrationError, meanAbsoluteError: predictions.reduce((sum, row) => sum + row.error, 0) / predictions.length,
  byMarket: Object.fromEntries(Object.keys(MARKETS).map(market => { const rows = predictions.filter(row => row.market === market);
    return [market, { count: rows.length, brier: rows.reduce((sum, row) => sum + (row.probability - row.outcome) ** 2, 0) / rows.length }]; })) };
const calibrationPassed = metrics.predictions >= GATE.minimumPredictions && leakageViolations === 0
  && calibrationError <= GATE.maximumCalibrationError && metrics.brier < metrics.baselineBrier;
return { metrics, bins, calibrationPassed };
}
const development = evaluate(predictions.filter(row => !row.holdout));
const holdout = evaluate(predictions.filter(row => row.holdout));
const { metrics, bins, calibrationPassed } = holdout;
const report = { modelVersion: NBA_V2_MODEL_VERSION, generatedAt: new Date().toISOString(), parameters: NBA_V2_PARAMETERS, gate: GATE,
  sample: `First ${EARLY_GAMES} 2025-26 regular-season games per current roster player; 2024-25 regular season as prior baseline.`,
  referenceLine: 'floor(prior-season mean of last 40 qualifying games) + 0.5; historical sportsbook lines/prices unavailable.',
  metrics, calibrationBins: bins, calibrationPassed, gateSample: 'Held-out players (odd ESPN IDs); development players reported separately.',
  development: development.metrics,
  evValidated: false, evReason: 'No historical sportsbook prices are available, so EV against real prices cannot be validated.',
  publishable: false };
mkdirSync('reports/nba-v2', { recursive: true });
writeFileSync('reports/nba-v2/validation.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ holdout: { ...metrics, byMarket: undefined }, byMarket: metrics.byMarket, development: { ...development.metrics, byMarket: undefined }, calibrationPassed, bins }, null, 1));
