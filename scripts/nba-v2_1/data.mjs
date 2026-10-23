// NBA V2.1 shared evaluation helpers. Separate from frozen V2 scripts (reports/nba-v2/holdout-freeze.json).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { projectNBAEarlySeason } from '../../lib/nba/prediction/v2/earlySeason.ts';
import { json, sameTeam } from '../nba-v2/espnWindow.mjs';

export const WINDOW_GAMES = 10;
export const V21_SEASONS = Object.freeze({
  2024: { label: '2023-24', start: '2023-10-22', end: '2023-12-20' },
  2025: { label: '2024-25', start: '2024-10-20', end: '2024-12-20' },
  2026: { label: '2025-26', start: '2025-10-19', end: '2025-12-20' },
});
export const MARKETS = { player_points: 'points', player_rebounds: 'rebounds', player_assists: 'assists' };
// Timing rule V2.1: snapshot must be at or before the provider event commence_time minus 60 minutes.
export const SNAPSHOT_LEAD_MS = 60 * 60000;

export async function windowGames(season) {
  const config = V21_SEASONS[season];
  const played = new Map(); const games = [];
  for (let date = new Date(`${config.start}T12:00:00Z`); date < new Date(`${config.end}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1)) {
    const board = await json(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date.toISOString().slice(0, 10).replaceAll('-', '')}`);
    const events = (board?.events ?? []).filter(event => event.season?.type === 2);
    for (const event of events) {
      const teams = event.competitions[0].competitors.map(team => team.team.displayName);
      if (teams.every(team => (played.get(team) ?? 0) <= WINDOW_GAMES)) games.push({ espnId: event.id, tipoff: event.date, teams });
    }
    for (const event of events) for (const team of event.competitions[0].competitors) played.set(team.team.displayName, (played.get(team.team.displayName) ?? 0) + 1);
    if (played.size >= 30 && [...played.values()].every(count => count > WINDOW_GAMES)) break;
  }
  return games;
}

const playerKey = name => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[.'’-]/g, '').replace(/,/g, '').replace(/\b(jr|sr|ii|iii|iv)\b/g, '').replace(/\s+/g, ' ').trim();
function findPlayer(box, name) {
  const key = playerKey(name);
  if (box.has(key)) return box.get(key);
  const parts = key.split(' ');
  const options = [...box].filter(([other]) => other.split(' ').at(-1) === parts.at(-1) && other[0] === key[0]);
  return options.length === 1 ? options[0][1] : null;
}

const logCache = new Map();
async function seasonLogs(playerId, season) {
  const key = `${playerId}:${season}`;
  if (!logCache.has(key)) logCache.set(key, json(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${playerId}/gamelog?season=${season}`).then(data => {
    const names = data?.names ?? []; const rows = [];
    for (const type of data?.seasonTypes ?? []) if (/regular season/i.test(type.displayName ?? '')) for (const category of type.categories ?? []) for (const event of category.events ?? []) {
      const date = data.events?.[event.eventId]?.gameDate;
      if (date) rows.push({ gameId: event.eventId, date, stat: Object.fromEntries(names.map((name, index) => [name, Number(event.stats?.[index])])) });
    }
    return rows;
  }));
  return logCache.get(key);
}
const observe = (rows, market) => rows.map(row => ({ gameId: row.gameId, date: row.date, minutes: row.stat.minutes,
  value: row.stat[market === 'rebounds' ? 'totalRebounds' : market] }));

async function boxScore(espnId) {
  const summary = await json(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${espnId}`);
  const players = new Map();
  for (const team of summary?.boxscore?.players ?? []) {
    const block = team.statistics?.[0]; const keys = block?.keys ?? [];
    for (const row of block?.athletes ?? []) {
      const value = name => Number(row.stats?.[keys.indexOf(name)]);
      players.set(playerKey(row.athlete.displayName), { id: Number(row.athlete.id), didNotPlay: row.didNotPlay === true || !(value('minutes') > 0),
        minutes: value('minutes'), points: value('points'), rebounds: value('rebounds'), assists: value('assists') });
    }
  }
  return players;
}

/** Builds (and caches) every two-sided priced candidate for a season with V2 raw probabilities and settlement data. */
export async function buildCandidates(season, dataDir = join('data/nba-v2/historical', String(season))) {
  const cachePath = join('data/nba-v2/cache', `candidates-${season}.json`);
  if (existsSync(cachePath)) return JSON.parse(readFileSync(cachePath, 'utf8'));
  const games = await windowGames(season);
  const audit = { files: 0, unmatchedGames: 0, timingExcluded: 0, staleMarketExcluded: 0, unmatchedPlayers: {}, didNotPlay: 0, insufficientPrior: 0 };
  const candidates = [];
  for (const file of readdirSync(dataDir).filter(name => name.startsWith('espn-') && name.endsWith('.json'))) {
    audit.files += 1;
    const snapshot = JSON.parse(readFileSync(join(dataDir, file), 'utf8'));
    const event = snapshot.data; const commence = Date.parse(event.commence_time);
    const game = games.find(entry => Math.abs(Date.parse(entry.tipoff) - commence) <= 15 * 60000
      && entry.teams.some(team => sameTeam(team, event.home_team)) && entry.teams.some(team => sameTeam(team, event.away_team)));
    if (!game) { audit.unmatchedGames += 1; continue; }
    if (!(Date.parse(snapshot.timestamp) <= commence - SNAPSHOT_LEAD_MS)) { audit.timingExcluded += 1; continue; }
    const box = await boxScore(game.espnId);
    for (const book of event.bookmakers ?? []) for (const market of book.markets ?? []) {
      const statKey = MARKETS[market.key];
      if (!statKey) continue;
      // Provider stamps market last_update up to ~1 minute after the snapshot it belongs to; allow 2 minutes, never past commence - 55 min.
      if (!(Date.parse(market.last_update) <= Math.min(Date.parse(snapshot.timestamp) + 2 * 60000, commence - 55 * 60000))) { audit.staleMarketExcluded += 1; continue; }
      const pairs = new Map();
      for (const outcome of market.outcomes ?? []) {
        const id = `${outcome.description}|${outcome.point}`;
        pairs.set(id, { ...pairs.get(id), player: outcome.description, line: outcome.point, [outcome.name === 'Over' ? 'over' : 'under']: outcome.price });
      }
      for (const pair of pairs.values()) {
        if (pair.over == null || pair.under == null) continue;
        const actual = findPlayer(box, pair.player);
        if (!actual) { audit.unmatchedPlayers[pair.player] = (audit.unmatchedPlayers[pair.player] ?? 0) + 1; continue; }
        if (actual.didNotPlay) { audit.didNotPlay += 1; continue; }
        const [prior, current] = await Promise.all([seasonLogs(actual.id, season - 1), seasonLogs(actual.id, season)]);
        const projection = projectNBAEarlySeason({ priorSeason: observe(prior, statKey), currentSeason: observe(current, statKey), targetTipoff: game.tipoff, line: pair.line });
        if (projection.status !== 'AVAILABLE') { audit.insufficientPrior += 1; continue; }
        const implied = price => price > 0 ? 100 / (price + 100) : -price / (-price + 100);
        candidates.push({ gameId: game.espnId, tipoff: game.tipoff, playerId: actual.id, player: pair.player, market: statKey, line: pair.line, book: book.key,
          over: pair.over, under: pair.under, pOver: projection.overProbability, noVigOver: implied(pair.over) / (implied(pair.over) + implied(pair.under)),
          currentSeasonGames: projection.currentSeasonGames, minutes: actual.minutes, actual: actual[statKey] });
      }
    }
  }
  mkdirSync('data/nba-v2/cache', { recursive: true });
  const result = { season, audit, candidates };
  writeFileSync(cachePath, JSON.stringify(result));
  return result;
}
