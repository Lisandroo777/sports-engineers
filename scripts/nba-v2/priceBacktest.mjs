// NBA V2 price-based backtest. Never calls paid endpoints: it reads saved Odds API historical event-odds
// responses from data/nba-v2/historical/*.json and free ESPN data.
// Usage: node scripts/nba-v2/priceBacktest.mjs --plan          (free: exact holdout game count and credit cost)
//        node scripts/nba-v2/priceBacktest.mjs [dataDir]        (evaluate saved snapshots against pre-registered criteria)
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectNBAEarlySeason } from '../../lib/nba/prediction/v2/earlySeason.ts';
import { SEASONS, json, sameTeam, windowGames } from './espnWindow.mjs';

const CRITERIA_PATH = 'reports/nba-v2/publication-criteria.json';
const criteriaText = readFileSync(CRITERIA_PATH, 'utf8');
const criteria = JSON.parse(criteriaText);
const criteriaHash = createHash('sha256').update(criteriaText).digest('hex');
const MARKETS = { player_points: 'points', player_rebounds: 'rebounds', player_assists: 'assists' };
const args = process.argv.slice(2);
const SEASON = Number(args[args.indexOf('--season') + 1] || 2026);
if (!SEASONS[SEASON]) throw new Error(`Unsupported season ${SEASON}`);
const SNAPSHOT_LEAD_MS = 60 * 60000;
const holdoutGames = () => windowGames(SEASON);

if (process.argv.includes('--plan')) {
  const games = await holdoutGames();
  const dates = new Set(games.map(game => game.tipoff.slice(0, 10)));
  const plan = (markets, count = games.length, dateCount = dates.size) => ({ games: count, eventListCalls: dateCount,
    maxCredits: count * 10 * markets + dateCount, note: 'Upper bound: event-odds cost counts only markets actually returned; empty responses are free.' });
  console.log(JSON.stringify({ criteriaHash, holdoutGames: games.length, dates: dates.size,
    smokeTest_1game_points: plan(1, 1, 1), feasibility_20games_points: plan(1, 20, new Set(games.slice(0, 20).map(g => g.tipoff.slice(0, 10))).size),
    holdout_points: plan(1), holdout_threeMarkets: plan(3) }, null, 1));
  process.exit(0);
}

const dataDir = args.find(value => !value.startsWith('--') && value !== String(SEASON)) ?? `data/nba-v2/historical/${SEASON}`;
if (!existsSync(dataDir)) { console.error(`No saved historical snapshots in ${dataDir}; nothing evaluated. Purchase requires separate approval.`); process.exit(1); }

const logCache = new Map();
async function logs(playerId, season, statKey) {
  const key = `${playerId}:${season}`;
  if (!logCache.has(key)) logCache.set(key, json(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${playerId}/gamelog?season=${season}`).then(data => {
    const names = data?.names ?? []; const rows = [];
    for (const type of data?.seasonTypes ?? []) if (/regular season/i.test(type.displayName ?? '')) for (const category of type.categories ?? []) for (const event of category.events ?? []) {
      const date = data.events?.[event.eventId]?.gameDate;
      if (date) rows.push({ gameId: event.eventId, date, stat: Object.fromEntries(names.map((name, index) => [name, Number(event.stats?.[index])])) });
    }
    return rows;
  }));
  const rows = await logCache.get(key);
  const stat = statKey === 'rebounds' ? 'totalRebounds' : statKey;
  return rows.map(row => ({ gameId: row.gameId, date: row.date, minutes: row.stat.minutes, value: row.stat[stat] }));
}

const playerKey = name => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[.'’-]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/\s+/g, ' ').trim();
function findPlayer(box, name) {
  const key = playerKey(name);
  if (box.has(key)) return box.get(key);
  const parts = key.split(' ');
  // Nickname fallback: unique same-game last name with the same first initial only.
  const options = [...box].filter(([other]) => other.split(' ').at(-1) === parts.at(-1) && other[0] === key[0]);
  return options.length === 1 ? options[0][1] : null;
}

async function boxScore(espnId) {
  const summary = await json(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${espnId}`);
  const players = new Map();
  for (const team of summary?.boxscore?.players ?? []) {
    const block = team.statistics?.[0]; const keys = block?.keys ?? [];
    for (const row of block?.athletes ?? []) {
      const value = name => Number(row.stats?.[keys.indexOf(name)]);
      players.set(playerKey(row.athlete.displayName), { id: Number(row.athlete.id), minutes: value('minutes'), points: value('points'),
        rebounds: value('rebounds'), assists: value('assists') });
    }
  }
  return players;
}

const holdout = await holdoutGames();
const candidates = []; let leakageViolations = 0; let voided = 0; let unmatched = 0;
const unmatchedNames = new Map();
for (const file of readdirSync(dataDir).filter(name => name.startsWith('espn-') && name.endsWith('.json'))) {
  const snapshot = JSON.parse(readFileSync(join(dataDir, file), 'utf8'));
  const event = snapshot.data; const tipoff = Date.parse(event.commence_time);
  const game = holdout.find(entry => Math.abs(Date.parse(entry.tipoff) - tipoff) <= 15 * 60000
    && entry.teams.some(team => sameTeam(team, event.home_team)) && entry.teams.some(team => sameTeam(team, event.away_team)));
  if (!game) { unmatched += 1; continue; }
  if (!(Date.parse(snapshot.timestamp) <= tipoff - SNAPSHOT_LEAD_MS)) { leakageViolations += 1; continue; }
  const box = await boxScore(game.espnId);
  for (const book of event.bookmakers ?? []) for (const market of book.markets ?? []) {
    const statKey = MARKETS[market.key];
    if (!statKey || !(Date.parse(market.last_update) < tipoff)) { if (statKey) leakageViolations += 1; continue; }
    const pairs = new Map();
    for (const outcome of market.outcomes ?? []) {
      const id = `${outcome.description}|${outcome.point}`;
      pairs.set(id, { ...pairs.get(id), player: outcome.description, line: outcome.point, [outcome.name === 'Over' ? 'over' : 'under']: outcome.price });
    }
    for (const pair of pairs.values()) {
      if (pair.over == null || pair.under == null) continue;
      const actual = findPlayer(box, pair.player);
      if (!actual) { unmatched += 1; unmatchedNames.set(pair.player, (unmatchedNames.get(pair.player) ?? 0) + 1); continue; }
      if (!(actual.minutes >= 5)) { voided += 1; continue; }
      const season = SEASON;
      const projection = projectNBAEarlySeason({ priorSeason: await logs(actual.id, season - 1, statKey), currentSeason: await logs(actual.id, season, statKey),
        targetTipoff: event.commence_time, line: pair.line });
      if (projection.status !== 'AVAILABLE') continue;
      const implied = price => price > 0 ? 100 / (price + 100) : -price / (-price + 100);
      const noVigOver = implied(pair.over) / (implied(pair.over) + implied(pair.under));
      candidates.push({ gameId: game.espnId, playerId: actual.id, player: pair.player, market: statKey, line: pair.line, book: book.key,
        tipoff: event.commence_time, over: pair.over, under: pair.under, pOver: projection.overProbability, noVigOver,
        outcomeOver: actual[statKey] > pair.line ? 1 : actual[statKey] < pair.line ? 0 : null });
    }
  }
}

const settled = candidates.filter(row => row.outcomeOver != null);
const profit = price => price > 0 ? price / 100 : 100 / -price;
const rule = criteria.selectionRule;
const best = new Map();
for (const row of settled) for (const side of ['over', 'under']) {
  const p = side === 'over' ? row.pOver : 1 - row.pOver; const price = row[side];
  const ev = (p * profit(price) - (1 - p)) * 100;
  if (ev < rule.minimumHypotheticalEvPercent || p < rule.probabilityBounds[0] || p > rule.probabilityBounds[1]) continue;
  const key = `${row.gameId}|${row.playerId}|${row.market}`;
  const won = side === 'over' ? row.outcomeOver === 1 : row.outcomeOver === 0;
  if (!best.has(key) || best.get(key).ev < ev) best.set(key, { ...row, side, ev, returnUnits: won ? profit(price) : -1 });
}
const bets = [...best.values()];
const roi = rows => rows.length ? rows.reduce((sum, bet) => sum + bet.returnUnits, 0) / rows.length : null;
const byGame = new Map(); for (const bet of bets) byGame.set(bet.gameId, [...(byGame.get(bet.gameId) ?? []), bet]);
const clusters = [...byGame.values()]; const samples = [];
let seed = 12345; const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
for (let index = 0; index < 10000 && clusters.length; index += 1) samples.push(roi(Array.from({ length: clusters.length }, () => clusters[Math.floor(random() * clusters.length)]).flat()));
samples.sort((a, b) => a - b);
const bins = Array.from({ length: 10 }, () => ({ count: 0, predicted: 0, observed: 0 }));
for (const row of settled) { const bin = bins[Math.min(9, Math.floor(row.pOver * 10))]; bin.count += 1; bin.predicted += row.pOver; bin.observed += row.outcomeOver; }
const ece = settled.length ? bins.reduce((sum, bin) => sum + (bin.count ? Math.abs(bin.predicted - bin.observed) : 0), 0) / settled.length : null;
const brier = key => settled.length ? settled.reduce((sum, row) => sum + (row[key] - row.outcomeOver) ** 2, 0) / settled.length : null;
const chronological = [...bets].sort((a, b) => Date.parse(a.tipoff) - Date.parse(b.tipoff));
const playerProfit = new Map(); for (const bet of bets) playerProfit.set(bet.playerId, (playerProfit.get(bet.playerId) ?? 0) + bet.returnUnits);
const topPlayers = new Set([...playerProfit].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([id]) => id));
const playerCounts = new Map(); for (const bet of bets) playerCounts.set(bet.playerId, (playerCounts.get(bet.playerId) ?? 0) + 1);
const c = criteria.publicationCriteria;
const metrics = { candidates: candidates.length, settledCandidates: settled.length, bets: bets.length, roi: roi(bets),
  roi95: samples.length ? [samples[Math.floor(samples.length * 0.025)], samples[Math.floor(samples.length * 0.975)]] : null,
  expectedCalibrationError: ece, brier: brier('pOver'), noVigMarketBrier: brier('noVigOver'), leakageViolations, voided, unmatched,
  roiByMarket: Object.fromEntries(Object.values(MARKETS).map(market => { const rows = bets.filter(bet => bet.market === market); return [market, { bets: rows.length, roi: roi(rows) }]; })),
  roiByHalf: [roi(chronological.slice(0, Math.floor(chronological.length / 2))), roi(chronological.slice(Math.floor(chronological.length / 2)))],
  maxPlayerShare: bets.length ? Math.max(...playerCounts.values()) / bets.length : null, roiWithoutTop10Players: roi(bets.filter(bet => !topPlayers.has(bet.playerId))),
  roiByBook: Object.fromEntries([...new Set(bets.map(bet => bet.book))].map(book => { const rows = bets.filter(bet => bet.book === book); return [book, { bets: rows.length, roi: roi(rows) }]; })),
  playersByBets: [...playerCounts].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([id, count]) => ({ player: bets.find(bet => bet.playerId === id).player, bets: count, profitUnits: playerProfit.get(id) })),
  meanSelectedEvPercent: bets.length ? bets.reduce((sum, bet) => sum + bet.ev, 0) / bets.length : null,
  unmatchedPlayers: unmatchedNames.size, topUnmatched: [...unmatchedNames].sort((a, b) => b[1] - a[1]).slice(0, 10) };
const checks = {
  minimumQualifyingBets: metrics.bets >= c.minimumQualifyingBets,
  roiLowerBound: metrics.roi95 != null && metrics.roi95[0] > c.roi95LowerBoundAbove,
  calibration: ece != null && ece <= c.maximumExpectedCalibrationError,
  brierVersusMarket: metrics.brier != null && metrics.brier <= metrics.noVigMarketBrier + c.brierNotWorseThanNoVigMarketBy,
  marketStability: Object.values(metrics.roiByMarket).every(entry => entry.bets < c.stability.roiPointEstimatePositiveEachMarketWithAtLeastBets || entry.roi > 0),
  halfStability: metrics.roiByHalf.every(value => value != null && value > 0),
  playerConcentration: metrics.maxPlayerShare != null && metrics.maxPlayerShare <= c.stability.maximumShareOfBetsFromOnePlayer,
  withoutTopPlayers: metrics.roiWithoutTop10Players != null && metrics.roiWithoutTop10Players > 0,
  leakage: leakageViolations <= c.leakageViolationsAllowed,
};
const role = SEASONS[SEASON].role;
const report = { modelVersion: criteria.modelVersion, season: SEASONS[SEASON].label, role, criteriaHash, evaluatedAt: new Date().toISOString(), dataDir, metrics, checks,
  allPassed: role === 'HOLDOUT' && Object.values(checks).every(Boolean), publishable: false,
  note: role === 'HOLDOUT' ? 'publishable stays false; a passing holdout only permits proposing publication for approval.'
    : 'Development season: checks are diagnostic only and cannot qualify V2 for publication.' };
mkdirSync('reports/nba-v2', { recursive: true });
writeFileSync(`reports/nba-v2/price-backtest-${SEASON}.json`, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ role, metrics, checks, allPassed: report.allPassed }, null, 1));
