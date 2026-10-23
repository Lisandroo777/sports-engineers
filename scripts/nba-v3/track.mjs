// Research-only NBA forward tracking. Captures pregame lines/odds with model predictions; settles from ESPN box scores.
// Persists in Upstash Redis (namespace nba:track:v1:) when UPSTASH_REDIS_REST_URL/TOKEN are set, else local files (dev only).
// Dry run by default. Paid capture requires --execute and --approved-credits N (per run); the daily cap is enforced atomically.
//   node scripts/nba-v3/track.mjs capture [--execute --approved-credits 150]
//   node scripts/nba-v3/track.mjs settle
//   node scripts/nba-v3/track.mjs status
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { projectNBAEarlySeason } from '../../lib/nba/prediction/v2/earlySeason.ts';
import { json, sameTeam } from '../nba-v2/espnWindow.mjs';

export const TRACKING_CONFIG = Object.freeze({
  namespace: 'nba:track:v1:',
  markets: { player_points: 'points', player_rebounds: 'totalRebounds', player_assists: 'assists' },
  region: 'us',
  // Capture once per event when it is 60-120 minutes before the sportsbook start time.
  minLeadMs: 60 * 60000,
  maxLeadMs: 120 * 60000,
  dailyCreditCap: 150,
  providerReserve: 2000,
  settleAfterMs: 4 * 3600000,
  recordTtlSeconds: 400 * 86400,
});
const C = TRACKING_CONFIG;
const args = process.argv.slice(2);
const mode = args[0];
const execute = args.includes('--execute');
const approved = Number(args[args.indexOf('--approved-credits') + 1] || 0);
const modelVersion = { v2: 'NBA_MODEL_V2_EARLY_SEASON', commit: process.env.GITHUB_SHA ?? 'local' };

const redisUrl = process.env.UPSTASH_REDIS_REST_URL?.trim(); const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
async function redis(...command) {
  const response = await fetch(redisUrl, { method: 'POST', headers: { authorization: `Bearer ${redisToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(command), signal: AbortSignal.timeout(15000) });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(`Tracking storage error (${response.status}).`);
  return body.result;
}
const LOCAL = 'data/nba-v3/tracking';
const local = () => { mkdirSync(LOCAL, { recursive: true }); const path = `${LOCAL}/store.json`; return { path, data: existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {} }; };
const save = s => writeFileSync(s.path, JSON.stringify(s.data));
const store = redisUrl && redisToken ? {
  kind: 'UPSTASH_REDIS',
  claim: (key, ttl) => redis('SET', C.namespace + key, '1', 'NX', 'EX', String(ttl)).then(result => result === 'OK'),
  release: key => redis('DEL', C.namespace + key),
  incr: async (key, by) => { const value = Number(await redis('INCRBY', C.namespace + key, String(by))); await redis('EXPIRE', C.namespace + key, String(3 * 86400)); return value; },
  get: key => redis('GET', C.namespace + key),
  put: (key, value) => redis('SET', C.namespace + key, JSON.stringify(value), 'EX', String(C.recordTtlSeconds)),
  addIndex: (set, member) => redis('SADD', C.namespace + set, member),
  index: set => redis('SMEMBERS', C.namespace + set),
} : {
  kind: 'LOCAL_FILES',
  async claim(key) { const s = local(); if (s.data[key]) return false; s.data[key] = '1'; save(s); return true; },
  async release(key) { const s = local(); delete s.data[key]; save(s); },
  async incr(key, by) { const s = local(); s.data[key] = Number(s.data[key] ?? 0) + by; save(s); return s.data[key]; },
  async get(key) { return local().data[key] ?? null; },
  async put(key, value) { const s = local(); s.data[key] = JSON.stringify(value); save(s); },
  async addIndex(set, member) { const s = local(); s.data[set] = [...new Set([...(s.data[set] ?? []), member])]; save(s); },
  async index(set) { return local().data[set] ?? []; },
};

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
const nameKey = name => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[.'’,-]/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/\s+/g, ' ').trim();

async function capture() {
  const key = process.env.THE_ODDS_API_KEY?.trim();
  if (!key) throw new Error('THE_ODDS_API_KEY not available.');
  const eventsResponse = await fetch(`https://api.the-odds-api.com/v4/sports/basketball_nba/events?apiKey=${key}`, { signal: AbortSignal.timeout(20000) });
  if (!eventsResponse.ok) throw new Error(`Events list unavailable (${eventsResponse.status}).`);
  const now = Date.now();
  const events = (await eventsResponse.json()).filter(event => { const lead = Date.parse(event.commence_time) - now; return lead >= C.minLeadMs && lead <= C.maxLeadMs; });
  const day = new Date(now).toISOString().slice(0, 10);
  const worst = Object.keys(C.markets).length;
  console.log(JSON.stringify({ storage: store.kind, eligibleGames: events.length, maxCredits: events.length * worst, dailyCap: C.dailyCreditCap,
    dailyUsed: Number(await store.get(`credits:${day}`) ?? 0) }));
  if (!events.length) { console.log('No eligible games; no paid requests.'); return; }
  if (!execute) { console.log('DRY RUN: only the free events list was read.'); return; }
  if (!(approved > 0)) throw new Error('An explicit --approved-credits ceiling is required.');
  const espnGames = [];
  for (const offset of [-1, 0, 1]) {
    const board = await json(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${new Date(now + offset * 86400000).toISOString().slice(0, 10).replaceAll('-', '')}`);
    espnGames.push(...(board?.events ?? []));
  }
  let spent = 0;
  for (const event of events) {
    if (spent + worst > approved) { console.log('Per-run ceiling reached; stopping.'); break; }
    if (!(await store.claim(`lock:${event.id}`, 30 * 86400))) continue;
    const used = await store.incr(`credits:${day}`, worst);
    if (used > C.dailyCreditCap) { await store.incr(`credits:${day}`, -worst); await store.release(`lock:${event.id}`); console.log('Daily credit cap reached; stopping.'); break; }
    const response = await fetch(`https://api.the-odds-api.com/v4/sports/basketball_nba/events/${event.id}/odds?apiKey=${key}&regions=${C.region}&markets=${Object.keys(C.markets).join(',')}&oddsFormat=american`, { signal: AbortSignal.timeout(30000) });
    const cost = Number(response.headers.get('x-requests-last') ?? worst); const remaining = Number(response.headers.get('x-requests-remaining'));
    await store.incr(`credits:${day}`, cost - worst); spent += cost;
    if (!response.ok) { await store.release(`lock:${event.id}`); console.log(`Provider ${response.status}; stopping.`); break; }
    const odds = await response.json(); const capturedAt = new Date().toISOString();
    const espn = espnGames.find(entry => Math.abs(Date.parse(entry.date) - Date.parse(event.commence_time)) <= 15 * 60000
      && entry.competitions[0].competitors.some(team => sameTeam(team.team.displayName, event.home_team)));
    const roster = new Map();
    for (const competitor of espn?.competitions?.[0]?.competitors ?? []) {
      const team = await json(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${competitor.team.id}/roster`);
      for (const athlete of team?.athletes ?? []) roster.set(nameKey(athlete.displayName ?? athlete.fullName ?? ''), Number(athlete.id));
    }
    const records = []; const projections = new Map();
    for (const book of odds.bookmakers ?? []) for (const market of book.markets ?? []) for (const over of (market.outcomes ?? []).filter(o => o.name === 'Over')) {
      const under = market.outcomes.find(o => o.name === 'Under' && o.description === over.description && o.point === over.point);
      if (!under) continue;
      const playerId = roster.get(nameKey(over.description)) ?? null;
      let v2 = { status: playerId ? 'NOT_EVALUATED' : 'UNMATCHED_PLAYER' };
      if (playerId && espn) {
        const stat = C.markets[market.key]; const season = seasonYear(new Date(espn.date)); const cacheKey = `${playerId}:${stat}`;
        if (!projections.has(cacheKey)) projections.set(cacheKey, Promise.all([seasonLogs(playerId, season - 1, stat), seasonLogs(playerId, season, stat)]));
        const [prior, current] = await projections.get(cacheKey);
        // ESPN tipoff (not sportsbook commence) is the model cutoff, so the target game's own log can never enter.
        const projection = projectNBAEarlySeason({ priorSeason: prior, currentSeason: current, targetTipoff: espn.date, line: over.point });
        v2 = projection.status === 'AVAILABLE' ? { status: 'AVAILABLE', overProbability: projection.overProbability, expectedStat: projection.expectedStat,
          priorSeasonGames: projection.priorSeasonGames, currentSeasonGames: projection.currentSeasonGames } : { status: projection.status };
      }
      records.push({ book: book.key, market: market.key, marketLastUpdate: market.last_update, player: over.description, playerId,
        line: over.point, overPrice: over.price, underPrice: under.price, v2 });
    }
    await store.put(`capture:${event.id}`, { research: 'RESEARCH_ONLY_NOT_A_PICK', publishable: false, capturedAt, modelVersion, creditsCharged: cost,
      providerRemaining: remaining, eventId: event.id, espnId: espn?.id ?? null, espnTipoff: espn?.date ?? null, commenceTime: event.commence_time,
      homeTeam: event.home_team, awayTeam: event.away_team, records });
    await store.addIndex('events', event.id);
    console.log(JSON.stringify({ event: `${event.away_team} @ ${event.home_team}`, records: records.length, cost }));
    if (Number.isFinite(remaining) && remaining < C.providerReserve + worst) { console.log('Provider reserve reached; stopping.'); break; }
  }
  console.log(JSON.stringify({ spentThisRun: spent, dailyUsed: Number(await store.get(`credits:${day}`) ?? 0) }));
}

async function settle() {
  let settled = 0; let pending = 0;
  const stat = { player_points: 'points', player_rebounds: 'rebounds', player_assists: 'assists' };
  for (const eventId of await store.index('events')) {
    if (await store.get(`settled:${eventId}`)) continue;
    const captured = JSON.parse(await store.get(`capture:${eventId}`) ?? 'null');
    if (!captured?.espnId || Date.parse(captured.commenceTime) > Date.now() - C.settleAfterMs) { pending += 1; continue; }
    const summary = await json(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${captured.espnId}`);
    if (summary?.header?.competitions?.[0]?.status?.type?.completed !== true) { pending += 1; continue; }
    const box = new Map();
    for (const team of summary.boxscore?.players ?? []) { const block = team.statistics?.[0]; const keys = block?.keys ?? [];
      for (const row of block?.athletes ?? []) box.set(Number(row.athlete.id), { didNotPlay: row.didNotPlay === true, minutes: Number(row.stats?.[keys.indexOf('minutes')]),
        points: Number(row.stats?.[keys.indexOf('points')]), rebounds: Number(row.stats?.[keys.indexOf('rebounds')]), assists: Number(row.stats?.[keys.indexOf('assists')]) }); }
    const results = captured.records.map(record => {
      const actual = record.playerId == null ? null : box.get(record.playerId);
      if (!actual) return { ...record, result: 'UNMATCHED' };
      if (actual.didNotPlay || !(actual.minutes > 0)) return { ...record, result: 'VOID_DID_NOT_PLAY' };
      const value = actual[stat[record.market]];
      return { ...record, actual: value, minutes: actual.minutes, result: value > record.line ? 'OVER' : value < record.line ? 'UNDER' : 'PUSH' };
    });
    await store.put(`settled:${eventId}`, { settledAt: new Date().toISOString(), eventId, espnId: captured.espnId, results });
    settled += 1;
  }
  console.log(JSON.stringify({ storage: store.kind, settled, pending }));
}

async function status() {
  const events = await store.index('events'); let settled = 0; let records = 0;
  for (const eventId of events) { if (await store.get(`settled:${eventId}`)) settled += 1; const c = JSON.parse(await store.get(`capture:${eventId}`) ?? 'null'); records += c?.records?.length ?? 0; }
  console.log(JSON.stringify({ storage: store.kind, capturedEvents: events.length, settledEvents: settled, records,
    creditsToday: Number(await store.get(`credits:${new Date().toISOString().slice(0, 10)}`) ?? 0) }));
}

if (mode === 'capture') await capture();
else if (mode === 'settle') await settle();
else if (mode === 'status') await status();
else console.log('Usage: track.mjs capture [--execute --approved-credits N] | settle | status');
