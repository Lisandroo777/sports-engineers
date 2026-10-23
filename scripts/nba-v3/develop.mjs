// NBA V3 development: leakage-safe pregame features from free ESPN game logs.
// Projection is trained on the full 2023-24 regular season (no odds needed) and tested on 2024-25 early-season
// sportsbook candidates in chronological order. Never reads the examined 2025-26 holdout. Usage: node scripts/nba-v3/develop.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { json } from '../nba-v2/espnWindow.mjs';
import { projectNBAEarlySeason } from '../../lib/nba/prediction/v2/earlySeason.ts';

const MARKETS = ['points', 'rebounds', 'assists'];
const STAT = { points: 'points', rebounds: 'totalRebounds', assists: 'assists' };
const CACHE = 'data/nba-v2/cache/logs';
mkdirSync(CACHE, { recursive: true });

async function logs(playerId, season) {
  const path = `${CACHE}/${playerId}-${season}.json`;
  if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
  const data = await json(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${playerId}/gamelog?season=${season}`);
  const names = data?.names ?? []; const rows = new Map();
  for (const type of data?.seasonTypes ?? []) if (/regular season/i.test(type.displayName ?? '')) for (const category of type.categories ?? []) for (const event of category.events ?? []) {
    const meta = data.events?.[event.eventId]; if (!meta?.gameDate) continue;
    const stat = Object.fromEntries(names.map((name, index) => [name, Number(event.stats?.[index])]));
    const [fga] = String(event.stats?.[names.indexOf('fieldGoalsMade-fieldGoalsAttempted')] ?? '0-0').split('-').slice(1).map(Number);
    const fta = Number(String(event.stats?.[names.indexOf('freeThrowsMade-freeThrowsAttempted')] ?? '0-0').split('-')[1]);
    const home = meta.atVs !== '@';
    rows.set(event.eventId, { gameId: event.eventId, date: meta.gameDate, playerId, season, home, opponent: meta.opponent?.id,
      team: home ? meta.homeTeamId : meta.awayTeamId, gameTotal: Number(meta.homeTeamScore) + Number(meta.awayTeamScore),
      minutes: stat.minutes, points: stat.points, totalRebounds: stat.totalRebounds, assists: stat.assists, usage: (fga || 0) + 0.44 * (fta || 0) });
  }
  const list = [...rows.values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  writeFileSync(path, JSON.stringify(list));
  return list;
}

const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const played = row => row.minutes > 0;

/** Chronological feature builder: every feature uses only rows dated strictly before the target tipoff. */
function featureBuilder(allRows) {
  const sorted = [...allRows].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const oppSums = {}; const teamGames = new Map(); const teamTotals = new Map(); const byPlayer = new Map();
  for (const row of sorted) byPlayer.set(`${row.playerId}:${row.season}`, [...(byPlayer.get(`${row.playerId}:${row.season}`) ?? []), row]);
  return {
    sorted,
    // Called in chronological order; `update` must run after all rows of a timestamp are featurized.
    features(target, priorRows, market) {
      const before = (byPlayer.get(`${target.playerId}:${target.season}`) ?? []).filter(row => Date.parse(row.date) < Date.parse(target.date) && played(row));
      const prior = priorRows.filter(played).slice(-40);
      const observe = rows => rows.map(row => ({ gameId: row.gameId, date: row.date, minutes: row.minutes, value: row[STAT[market]] }));
      const v2 = projectNBAEarlySeason({ priorSeason: observe(prior), currentSeason: observe(before), targetTipoff: target.date, line: 0 });
      if (v2.status !== 'AVAILABLE') return null;
      const priorMinutes = mean(prior.map(row => row.minutes)); const recent = before.slice(-3).map(row => row.minutes);
      const lastGame = before.at(-1);
      const rest = lastGame ? (Date.parse(target.date) - Date.parse(lastGame.date)) / 86400000 : 3;
      const rate = v2.expectedStat / Math.max(v2.expectedMinutes, 1);
      const usagePrior = prior.reduce((sum, row) => sum + row.usage, 0) / prior.reduce((sum, row) => sum + row.minutes, 0);
      const usageRecent = before.length ? before.slice(-5).reduce((sum, row) => sum + row.usage, 0) / before.slice(-5).reduce((sum, row) => sum + row.minutes, 0) : usagePrior;
      const opp = oppSums[`${target.season}:${target.opponent}:${market}`] ?? { ratio: 0, n: 0 };
      const oppFactor = (opp.ratio + 150) / (opp.n + 150);
      const pace = team => { const totals = teamTotals.get(`${target.season}:${team}`) ?? []; return (totals.reduce((s, v) => s + v, 0) + 225 * 10) / (totals.length + 10); };
      const paceFactor = (pace(target.team) + pace(target.opponent)) / 450;
      const lastTeamGame = (teamGames.get(`${target.season}:${target.team}`) ?? []).filter(game => Date.parse(game.date) < Date.parse(target.date)).at(-1);
      let freedMinutes = 0;
      if (lastTeamGame) for (const [key, rows] of byPlayer) {
        if (!key.endsWith(`:${target.season}`) || Number(key.split(':')[0]) === target.playerId) continue;
        const teamRows = rows.filter(row => row.team === target.team && Date.parse(row.date) < Date.parse(lastTeamGame.date) && played(row)).slice(-5);
        const avg = mean(teamRows.map(row => row.minutes));
        if (avg >= 24 && teamRows.length >= 3 && !rows.some(row => row.gameId === lastTeamGame.gameId && played(row))) freedMinutes += avg;
      }
      return { v2Expected: v2.expectedStat, v2Minutes: v2.expectedMinutes, rate, priorMinutes, lastMinutes: lastGame?.minutes ?? priorMinutes,
        recentMinutes: mean(recent) ?? priorMinutes, currentGames: before.length, backToBack: rest <= 1.5 ? 1 : 0, home: target.home ? 1 : 0,
        oppFactor, paceFactor, usageShift: usageRecent / Math.max(usagePrior, 1e-6), freedMinutes };
    },
    update(row) {
      if (!played(row)) return;
      const priorRate = row.priorRate;
      for (const market of MARKETS) {
        if (!(priorRate?.[market] > 0)) continue;
        const key = `${row.season}:${row.opponent}:${market}`; const entry = oppSums[key] ?? { ratio: 0, n: 0 };
        entry.ratio += Math.min(4, row[STAT[market]] / (priorRate[market] * row.minutes)); entry.n += 1; oppSums[key] = entry;
      }
      const teamKey = `${row.season}:${row.team}`; const games = teamGames.get(teamKey) ?? [];
      if (!games.some(game => game.gameId === row.gameId)) {
        games.push({ gameId: row.gameId, date: row.date }); teamGames.set(teamKey, games);
        teamTotals.set(teamKey, [...(teamTotals.get(teamKey) ?? []), row.gameTotal]);
      }
    },
  };
}

function regressionRow(f) {
  const base = f.rate * f.minutesHat;
  return [1, f.v2Expected, base, base * (f.oppFactor - 1), base * (f.paceFactor - 1), base * (f.usageShift - 1), f.rate * f.freedMinutes, f.home, f.backToBack * base];
}
const minutesRow = f => [1, f.priorMinutes, f.v2Minutes, f.lastMinutes, f.recentMinutes, f.backToBack, f.freedMinutes, f.home, Math.min(f.currentGames, 10)];
function ridge(X, y, lambda = 1) {
  const k = X[0].length; const A = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j && i > 0 ? lambda : 0))); const b = new Array(k).fill(0);
  for (let r = 0; r < X.length; r += 1) for (let i = 0; i < k; i += 1) { b[i] += X[r][i] * y[r]; for (let j = 0; j < k; j += 1) A[i][j] += X[r][i] * X[r][j]; }
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < k; i += 1) { let p = i; for (let r = i + 1; r < k; r += 1) if (Math.abs(M[r][i]) > Math.abs(M[p][i])) p = r; [M[i], M[p]] = [M[p], M[i]];
    for (let r = 0; r < k; r += 1) if (r !== i) { const f = M[r][i] / M[i][i]; for (let c = i; c <= k; c += 1) M[r][c] -= f * M[i][c]; } }
  return M.map((row, i) => row[k] / row[i]);
}
const dot = (w, x) => w.reduce((sum, value, index) => sum + value * x[index], 0);

async function seasonDataset(players, season) {
  const rows = []; const priorBy = new Map();
  for (let index = 0; index < players.length; index += 6) await Promise.all(players.slice(index, index + 6).map(async playerId => {
    const [prior, current] = await Promise.all([logs(playerId, season - 1), logs(playerId, season)]);
    priorBy.set(playerId, prior);
    const playedPrior = prior.filter(played);
    const priorRate = Object.fromEntries(MARKETS.map(market => [market, playedPrior.reduce((s, r) => s + r[STAT[market]], 0) / Math.max(1, playedPrior.reduce((s, r) => s + r.minutes, 0))]));
    for (const row of current) rows.push({ ...row, priorRate });
  }));
  return { rows, priorBy };
}

/** Featurize a season chronologically; returns training rows for played games. */
function featurize(dataset, targets) {
  const builder = featureBuilder(dataset.rows);
  const out = []; let pending = []; let currentDate = null;
  const flush = () => { for (const row of pending) builder.update(row); pending = []; };
  for (const row of builder.sorted) {
    if (row.date !== currentDate) { flush(); currentDate = row.date; }
    for (const target of targets?.get(row.gameId + ':' + row.playerId) ? [row] : targets ? [] : [row]) {
      if (!played(target)) continue;
      for (const market of MARKETS) {
        const f = builder.features(target, dataset.priorBy.get(target.playerId) ?? [], market);
        if (f) out.push({ gameId: target.gameId, playerId: target.playerId, date: target.date, market, f, actual: target[STAT[market]], minutes: target.minutes });
      }
    }
    pending.push(row);
  }
  return out;
}

const candidatesFile = JSON.parse(readFileSync('data/nba-v2/cache/candidates-2025.json', 'utf8'));
const candidates = candidatesFile.candidates;
const players = [...new Set(candidates.map(row => row.playerId))];
console.error(`players ${players.length}: loading 2022-23..2024-25 logs (free ESPN, disk-cached)`);

// 1) Train on the full 2023-24 season (ESPN 2024) with 2022-23 priors.
const train = featurize(await seasonDataset(players, 2024));
const model = {};
for (const market of MARKETS) {
  const rows = train.filter(row => row.market === market);
  const minutesW = ridge(rows.map(row => minutesRow(row.f)), rows.map(row => row.minutes));
  for (const row of rows) row.f.minutesHat = Math.max(0, dot(minutesW, minutesRow(row.f)));
  const statW = ridge(rows.map(row => regressionRow(row.f)), rows.map(row => row.actual));
  const residuals = rows.map(row => (row.actual - Math.max(0, dot(statW, regressionRow(row.f)))) / Math.sqrt(Math.max(dot(statW, regressionRow(row.f)), 0.5))).sort((a, b) => a - b);
  model[market] = { minutesW, statW, residuals: residuals.filter((_, i) => i % Math.max(1, Math.floor(residuals.length / 2000)) === 0), trainRows: rows.length };
}

// 2) Score 2024-25 window player-games (features from rows strictly before each tipoff).
const dev = await seasonDataset(players, 2025);
const targetKeys = new Map(candidates.map(row => [`${row.gameId}:${row.playerId}`, true]));
const scored = new Map();
for (const row of featurize(dev, targetKeys)) {
  const m = model[row.market]; row.f.minutesHat = Math.max(0, dot(m.minutesW, minutesRow(row.f)));
  row.v3Expected = Math.max(0, dot(m.statW, regressionRow(row.f)));
  scored.set(`${row.gameId}:${row.playerId}:${row.market}`, row);
}
const pOverV3 = (row, line) => { const scale = Math.sqrt(Math.max(row.v3Expected, 0.5)); const z = (line - row.v3Expected) / scale;
  const r = model[row.market].residuals; let count = 0; for (const value of r) if (value > z) count += 1; return (count + 0.5) / (r.length + 1); };

// 3) Projection accuracy per market on unique player-games.
const accuracy = Object.fromEntries(MARKETS.map(market => { const rows = [...scored.values()].filter(row => row.market === market);
  return [market, { playerGames: rows.length, maeV2: +mean(rows.map(row => Math.abs(row.f.v2Expected - row.actual))).toFixed(3), maeV3: +mean(rows.map(row => Math.abs(row.v3Expected - row.actual))).toFixed(3) }]; }));

// 4) Information beyond the market: chronological stacking on 2024-25 candidates.
const logit = p => Math.log(Math.min(0.995, Math.max(0.005, p)) / (1 - Math.min(0.995, Math.max(0.005, p))));
const sigmoid = x => 1 / (1 + Math.exp(-x));
const rows = candidates.map(row => { const s = scored.get(`${row.gameId}:${row.playerId}:${row.market}`); if (!s) return null;
  const outcome = row.actual > row.line ? 1 : row.actual < row.line ? 0 : null; if (outcome == null) return null;
  return { ...row, outcome, pV3: pOverV3(s, row.line), date: row.tipoff.slice(0, 10) }; }).filter(Boolean);
function fitLogistic(data, featureFns) {
  let w = new Array(featureFns.length + 1).fill(0);
  for (let step = 0; step < 30; step += 1) { const X = data.map(row => [1, ...featureFns.map(fn => fn(row))]); const k = w.length;
    const H = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => (i === j ? 1e-3 : 0))); const g = new Array(k).fill(0);
    for (let r = 0; r < X.length; r += 1) { const p = sigmoid(dot(w, X[r])); for (let i = 0; i < k; i += 1) { g[i] += (p - data[r].outcome) * X[r][i]; for (let j = 0; j < k; j += 1) H[i][j] += p * (1 - p) * X[r][i] * X[r][j]; } }
    const step_ = ridge(H.map(row => row.map(v => v)), g, 0); w = w.map((v, i) => v - step_[i]); }
  return w;
}
const logLoss = (data, w, fns) => data.map(row => { const p = sigmoid(dot(w, [1, ...fns.map(fn => fn(row))])); return -(row.outcome ? Math.log(p) : Math.log(1 - p)); });
const dates = [...new Set(rows.map(row => row.date))].sort(); const cut = dates[Math.floor(dates.length / 2)];
const marketOnly = [row => logit(row.noVigOver)]; const withV3 = [row => logit(row.noVigOver), row => logit(row.pV3)]; const withV2 = [row => logit(row.noVigOver), row => logit(row.pOver)];
const increments = Object.fromEntries(MARKETS.map(market => {
  const tr = rows.filter(row => row.market === market && row.date < cut); const te = rows.filter(row => row.market === market && row.date >= cut);
  const result = {};
  for (const [name, fns] of [['v2', withV2], ['v3', withV3]]) {
    const wBase = fitLogistic(tr, marketOnly); const wModel = fitLogistic(tr, fns);
    const base = logLoss(te, wBase, marketOnly); const mod = logLoss(te, wModel, fns);
    const games = new Map(); te.forEach((row, i) => games.set(row.gameId, [...(games.get(row.gameId) ?? []), base[i] - mod[i]]));
    const clusters = [...games.values()]; const samples = []; let seed = 11; const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let b = 0; b < 2000; b += 1) { const pick = Array.from({ length: clusters.length }, () => clusters[Math.floor(random() * clusters.length)]).flat(); samples.push(mean(pick)); }
    samples.sort((a, b) => a - b);
    result[name] = { testRows: te.length, logLossMarket: +mean(base).toFixed(5), logLossWithModel: +mean(mod).toFixed(5), improvement: +(mean(base) - mean(mod)).toFixed(5),
      improvement95: [+samples[50].toFixed(5), +samples[1949].toFixed(5)], modelWeight: +wModel[2].toFixed(3) };
  }
  return [market, result];
}));

const report = { modelVersion: 'NBA_MODEL_V3_DEV', generatedAt: new Date().toISOString(), publishable: false, holdout2025_26Used: false,
  training: { season: '2023-24 full regular season (ESPN logs, priors 2022-23)', rows: Object.fromEntries(MARKETS.map(m => [m, model[m].trainRows])) },
  test: { season: '2024-25 early-season sportsbook candidates', chronologicalCut: cut, candidates: rows.length },
  features: ['V2 baseline', 'projected minutes (prior, recent, last game, rest, freed teammate minutes, home)', 'opponent allowance factor', 'pace factor', 'usage shift', 'freed teammate minutes x rate', 'home', 'back-to-back'],
  accuracy, increments, coefficients: Object.fromEntries(MARKETS.map(m => [m, { minutes: model[m].minutesW.map(v => +v.toFixed(4)), stat: model[m].statW.map(v => +v.toFixed(4)) }])),
  inputsHash: createHash('sha256').update(readFileSync('data/nba-v2/cache/candidates-2025.json')).digest('hex') };
mkdirSync('reports/nba-v3', { recursive: true });
writeFileSync('reports/nba-v3/development.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ training: report.training, test: report.test, accuracy, increments, coefficients: report.coefficients }, null, 1));
