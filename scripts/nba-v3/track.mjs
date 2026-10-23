// Research-only NBA forward tracking. Captures pregame sportsbook lines/odds with V2 predictions, then settles from ESPN box scores.
// Dry run by default. Paid capture requires --execute and an explicit --approved-credits ceiling.
//   node --env-file=<env> scripts/nba-v3/track.mjs capture --execute --approved-credits 90
//   node scripts/nba-v3/track.mjs settle
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { projectNBAEarlySeason } from '../../lib/nba/prediction/v2/earlySeason.ts';
import { json, sameTeam } from '../nba-v2/espnWindow.mjs';

const args = process.argv.slice(2);
const mode = args[0];
const execute = args.includes('--execute');
const approved = Number(args[args.indexOf('--approved-credits') + 1] || 0);
const DIR = 'data/nba-v3/tracking';
const MARKETS = { player_points: 'points', player_rebounds: 'totalRebounds', player_assists: 'assists' };
const MIN_LEAD_MS = 60 * 60000;
const MAX_LEAD_MS = 6 * 3600000;
const PROVIDER_RESERVE = 2000;
const DAILY_LIMIT = 150;
mkdirSync(DIR, { recursive: true });
const today = new Date().toISOString().slice(0, 10);
const ledgerPath = `${DIR}/ledger-${today}.json`;
const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : { date: today, credits: 0, captured: [] };
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const seasonYear = date => date.getUTCMonth() >= 7 ? date.getUTCFullYear() + 1 : date.getUTCFullYear();

async function seasonLogs(playerId, season, stat) {
  const data = await json(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${playerId}/gamelog?season=${season}`);
  const names = data?.names ?? []; const rows = [];
  for (const type of data?.seasonTypes ?? []) if (/regular season/i.test(type.displayName ?? '')) for (const category of type.categories ?? []) for (const event of category.events ?? []) {
    const date = data.events?.[event.eventId]?.gameDate;
    if (date) rows.push({ gameId: event.eventId, date, minutes: Number(event.stats?.[names.indexOf('minutes')]), value: Number(event.stats?.[names.indexOf(stat)]) });
  }
  return rows;
}

async function capture() {
  const key = process.env.THE_ODDS_API_KEY?.trim();
  if (!key) throw new Error('THE_ODDS_API_KEY not available.');
  const events = await (await fetch(`https://api.the-odds-api.com/v4/sports/basketball_nba/events?apiKey=${key}`)).json();
  const now = Date.now();
  const eligible = events.filter(event => { const lead = Date.parse(event.commence_time) - now; return lead >= MIN_LEAD_MS && lead <= MAX_LEAD_MS && !ledger.captured.includes(event.id); });
  const plan = { eligibleGames: eligible.length, maxCredits: eligible.length * Object.keys(MARKETS).length, dailyUsed: ledger.credits, dailyLimit: DAILY_LIMIT };
  console.log(JSON.stringify(plan));
  if (!execute) { console.log('DRY RUN: only the free events list was read.'); return; }
  if (!(approved > 0)) throw new Error('An explicit --approved-credits ceiling is required.');
  const espnDate = new Date(now).toISOString().slice(0, 10).replaceAll('-', '');
  const board = await json(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${espnDate}`);
  let spent = 0;
  for (const event of eligible) {
    const worst = Object.keys(MARKETS).length;
    if (spent + worst > approved || ledger.credits + worst > DAILY_LIMIT) { console.log('Credit ceiling reached; stopping.'); break; }
    const espn = (board?.events ?? []).find(entry => Math.abs(Date.parse(entry.date) - Date.parse(event.commence_time)) <= 15 * 60000
      && entry.competitions[0].competitors.some(team => sameTeam(team.team.displayName, event.home_team)));
    const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${event.id}/odds?apiKey=${key}&regions=us&markets=${Object.keys(MARKETS).join(',')}&oddsFormat=american`;
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const cost = Number(response.headers.get('x-requests-last') ?? worst); const remaining = Number(response.headers.get('x-requests-remaining'));
    spent += cost; ledger.credits += cost; ledger.captured.push(event.id); writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
    if (!response.ok) { console.log(`Provider ${response.status}; stopping.`); break; }
    const odds = await response.json(); const capturedAt = new Date().toISOString();
    const roster = new Map();
    if (espn) {
      const summary = await json(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${espn.id}`);
      for (const team of summary?.rosters ?? summary?.boxscore?.players ?? []) for (const entry of team.roster ?? team.statistics?.[0]?.athletes ?? []) {
        const athlete = entry.athlete ?? entry; if (athlete?.displayName) roster.set(athlete.displayName.toLowerCase(), Number(athlete.id));
      }
    }
    for (const book of odds.bookmakers ?? []) for (const market of book.markets ?? []) for (const over of (market.outcomes ?? []).filter(o => o.name === 'Over')) {
      const under = market.outcomes.find(o => o.name === 'Under' && o.description === over.description && o.point === over.point);
      if (!under) continue;
      const playerId = roster.get(over.description.toLowerCase()) ?? null;
      let v2 = null;
      if (playerId) {
        const season = seasonYear(new Date(event.commence_time));
        const [prior, current] = await Promise.all([seasonLogs(playerId, season - 1, MARKETS[market.key]), seasonLogs(playerId, season, MARKETS[market.key])]);
        const projection = projectNBAEarlySeason({ priorSeason: prior, currentSeason: current, targetTipoff: espn?.date ?? event.commence_time, line: over.point });
        v2 = projection.status === 'AVAILABLE' ? { overProbability: projection.overProbability, expectedStat: projection.expectedStat,
          priorSeasonGames: projection.priorSeasonGames, currentSeasonGames: projection.currentSeasonGames } : { status: projection.status };
      }
      appendFileSync(`${DIR}/captures.jsonl`, `${JSON.stringify({ capturedAt, modelCommit: commit, eventId: event.id, espnId: espn?.id ?? null,
        commenceTime: event.commence_time, book: book.key, market: market.key, marketLastUpdate: market.last_update, player: over.description, playerId,
        line: over.point, overPrice: over.price, underPrice: under.price, v2, research: 'RESEARCH_ONLY_NOT_A_PICK' })}\n`);
    }
    if (Number.isFinite(remaining) && remaining < PROVIDER_RESERVE + worst) { console.log('Provider reserve reached; stopping.'); break; }
  }
  console.log(JSON.stringify({ spentThisRun: spent, dailyCredits: ledger.credits }));
}

async function settle() {
  const path = `${DIR}/captures.jsonl`; if (!existsSync(path)) { console.log('No captures.'); return; }
  const settledPath = `${DIR}/settled.jsonl`;
  const done = new Set(existsSync(settledPath) ? readFileSync(settledPath, 'utf8').trim().split('\n').filter(Boolean).map(line => { const r = JSON.parse(line); return `${r.eventId}|${r.book}|${r.market}|${r.player}|${r.line}`; }) : []);
  const boxes = new Map(); let settled = 0;
  for (const line of readFileSync(path, 'utf8').trim().split('\n')) {
    const row = JSON.parse(line); const id = `${row.eventId}|${row.book}|${row.market}|${row.player}|${row.line}`;
    if (done.has(id) || !row.espnId || Date.parse(row.commenceTime) > Date.now() - 4 * 3600000) continue;
    if (!boxes.has(row.espnId)) boxes.set(row.espnId, await json(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${row.espnId}`));
    const summary = boxes.get(row.espnId);
    if (summary?.header?.competitions?.[0]?.status?.type?.completed !== true) continue;
    let result = { status: 'UNMATCHED' };
    for (const team of summary.boxscore?.players ?? []) { const block = team.statistics[0]; const keys = block.keys;
      for (const athlete of block.athletes) if (athlete.athlete.displayName.toLowerCase() === row.player.toLowerCase()) {
        const minutes = Number(athlete.stats[keys.indexOf('minutes')]);
        const statName = { player_points: 'points', player_rebounds: 'rebounds', player_assists: 'assists' }[row.market];
        const actual = Number(athlete.stats[keys.indexOf(statName)]);
        result = athlete.didNotPlay || !(minutes > 0) ? { status: 'VOID_DID_NOT_PLAY' } : { status: actual > row.line ? 'OVER' : actual < row.line ? 'UNDER' : 'PUSH', actual, minutes };
      } }
    appendFileSync(settledPath, `${JSON.stringify({ ...row, settledAt: new Date().toISOString(), result })}\n`); settled += 1;
  }
  console.log(JSON.stringify({ settled }));
}

if (mode === 'capture') await capture();
else if (mode === 'settle') await settle();
else console.log('Usage: track.mjs capture [--execute --approved-credits N] | settle');
