// NBA V2 historical odds downloader for The Odds API. Dry run by default (no paid calls).
// Paid run requires an explicit approved credit ceiling:
//   node --env-file=<env> scripts/nba-v2/downloadHistorical.mjs --season 2026 --execute --approved-credits 4854
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SEASONS, sameTeam, windowGames } from './espnWindow.mjs';

const args = process.argv.slice(2);
const arg = name => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const season = Number(arg('--season') ?? 2026);
const execute = args.includes('--execute');
const approvedCredits = Number(arg('--approved-credits') ?? 0);
const maxGames = arg('--max-games') ? Number(arg('--max-games')) : Infinity;
const MARKETS = ['player_points', 'player_rebounds', 'player_assists'];
const LEAD_MS = 60 * 60000;
const PROVIDER_RESERVE = 2000;
const BASE = 'https://api.the-odds-api.com/v4/historical/sports/basketball_nba';
const outDir = join('data/nba-v2/historical', String(season));
const ledgerPath = join(outDir, 'ledger.json');

const config = SEASONS[season];
if (!config) throw new Error(`Unsupported season ${season}`);
const games = (await windowGames(season)).slice(0, maxGames);
const byDate = new Map();
for (const game of games) byDate.set(game.tipoff.slice(0, 10), [...(byDate.get(game.tipoff.slice(0, 10)) ?? []), game]);
const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : { season, creditsSpent: 0, requests: [], unmatched: [] };
const pending = games.filter(game => !existsSync(join(outDir, `espn-${game.espnId}.json`)));
const pendingDates = new Set(pending.map(game => game.tipoff.slice(0, 10)));
const plannedMax = pending.length * 10 * MARKETS.length + pendingDates.size;
const plan = { season: config.label, role: config.role, windowGames: games.length, alreadyDownloaded: games.length - pending.length,
  pendingGames: pending.length, eventListCalls: pendingDates.size, maxCredits: plannedMax, creditsSpentSoFar: ledger.creditsSpent,
  markets: MARKETS, region: 'us', snapshot: 'closest snapshot at or before tipoff - 60 minutes' };
console.log(JSON.stringify(plan, null, 1));
if (!execute) { console.log('DRY RUN: no paid requests made.'); process.exit(0); }

const key = process.env.THE_ODDS_API_KEY?.trim();
if (!key) throw new Error('THE_ODDS_API_KEY is not available in this process.');
if (!Number.isFinite(approvedCredits) || approvedCredits <= 0) throw new Error('An explicit --approved-credits ceiling is required.');
mkdirSync(outDir, { recursive: true });
ledger.unmatched = [];
let spentThisRun = 0;
const save = () => writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);

async function paid(path, params, worstCaseCost) {
  if (spentThisRun + worstCaseCost > approvedCredits) throw new Error(`Approved ceiling reached (${spentThisRun}/${approvedCredits}); stopping before request.`);
  const url = new URL(`${BASE}${path}`);
  url.searchParams.set('apiKey', key);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  const cost = Number(response.headers.get('x-requests-last') ?? worstCaseCost);
  const remaining = Number(response.headers.get('x-requests-remaining'));
  spentThisRun += cost; ledger.creditsSpent += cost;
  ledger.requests.push({ path, date: params.date, status: response.status, cost, remaining, at: new Date().toISOString() });
  save();
  if (response.status === 429) throw new Error('Provider rate limit; stopping (rerun resumes).');
  if (!response.ok) throw new Error(`Provider returned ${response.status}; stopping (rerun resumes).`);
  if (Number.isFinite(remaining) && remaining < PROVIDER_RESERVE + worstCaseCost) throw new Error(`Provider reserve ${PROVIDER_RESERVE} reached; stopping.`);
  return response.json();
}

for (const [date, dayGames] of byDate) {
  const todo = dayGames.filter(game => !existsSync(join(outDir, `espn-${game.espnId}.json`)));
  if (!todo.length) continue;
  const firstSnapshot = new Date(Math.min(...todo.map(game => Date.parse(game.tipoff))) - LEAD_MS).toISOString().replace('.000', '');
  const events = await paid('/events', { date: firstSnapshot }, 1);
  for (const game of todo) {
    const tipoff = Date.parse(game.tipoff);
    const matches = list => (list ?? []).find(entry => Math.abs(Date.parse(entry.commence_time) - tipoff) <= 15 * 60000
      && game.teams.some(team => sameTeam(team, entry.home_team)) && game.teams.some(team => sameTeam(team, entry.away_team)));
    let event = matches(events.data);
    if (!event) event = matches((await paid('/events', { date: new Date(tipoff - LEAD_MS).toISOString().replace('.000', '') }, 1)).data);
    if (!event) { ledger.unmatched.push({ espnId: game.espnId, date, teams: game.teams }); save(); continue; }
    const snapshotDate = new Date(tipoff - LEAD_MS).toISOString().replace('.000', '');
    const odds = await paid(`/events/${event.id}/odds`, { date: snapshotDate, regions: 'us', markets: MARKETS.join(','), oddsFormat: 'american' }, 10 * MARKETS.length);
    if (Date.parse(odds.timestamp) > tipoff - LEAD_MS) throw new Error(`Snapshot ${odds.timestamp} is after the pregame cutoff for ${event.id}; stopping.`);
    writeFileSync(join(outDir, `espn-${game.espnId}.json`), `${JSON.stringify({ espnId: game.espnId, ...odds }, null, 1)}\n`);
  }
}
console.log(JSON.stringify({ season: config.label, spentThisRun, creditsSpentTotal: ledger.creditsSpent, unmatched: ledger.unmatched.length }, null, 1));
