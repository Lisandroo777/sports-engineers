import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NBA_RESEARCH_MARKETS } from '../../lib/nba/researchMarkets.ts';

const root = fileURLToPath(new URL('../..', import.meta.url));
const undocumented = new Set(['field_goals_attempted', 'three_pointers_attempted', 'two_pointers_made', 'dunks',
  'defensive_rebounds', 'offensive_rebounds', 'personal_fouls', 'points_q2', 'points_q3', 'points_q4']);
const markets = NBA_RESEARCH_MARKETS.filter(entry => !undocumented.has(entry.id));
const execute = process.argv.includes('--execute-approved-63');
if (markets.length !== 31) throw new Error('Expected exactly 31 documented contracts.');
if (!execute) {
  console.log(JSON.stringify({ dryRun: true, networkRequests: 0, markets: markets.map(entry => entry.id),
    regions: 'us,us2', maxCredits: 63, requests: ['events (0)', 'event markets (1)', 'event odds (up to 62)'] }, null, 2));
} else {
  for (const path of [resolve(root, '.env.local'), '/Users/lisandrorodrigues/Sports engineers /sports-engineers/.env.local']) {
    if (!process.env.THE_ODDS_API_KEY && existsSync(path)) process.loadEnvFile(path);
  }
  const key = process.env.THE_ODDS_API_KEY?.trim();
  if (!key) throw new Error('THE_ODDS_API_KEY unavailable; no requests made.');
  const directory = resolve(root, 'data/nba-v3/live-market-verification', new Date().toISOString().replaceAll(':', '-'));
  mkdirSync(directory, { recursive: true });
  const calls = [];
  const report = { approval: 'One-time user approval; maximum 63 credits; no retries or automatic refresh',
    startedAt: new Date().toISOString(), regions: 'us,us2', requestedMarkets: markets.map(entry => entry.id), calls };
  let spent = 0;
  const save = () => writeFileSync(resolve(directory, 'report.json'), JSON.stringify({ ...report, creditsSpent: spent }, null, 2));
  async function request(path, parameters, maximumCost, label) {
    if (spent + maximumCost > 63) throw new Error('Remaining approval insufficient for worst-case request; stopped.');
    const url = new URL(`https://api.the-odds-api.com/v4/sports/basketball_nba${path}`);
    for (const [name, value] of Object.entries(parameters)) url.searchParams.set(name, value);
    url.searchParams.set('apiKey', key);
    let response;
    try { response = await fetch(url, { signal: AbortSignal.timeout(45000) }); }
    catch { report.issue = 'Request transport failure; credit usage uncertain. No retries.'; save(); throw new Error(report.issue); }
    const headers = Object.fromEntries(['x-requests-last', 'x-requests-used', 'x-requests-remaining'].map(name => [name, response.headers.get(name)]));
    const cost = headers['x-requests-last'] == null ? null : Number(headers['x-requests-last']);
    calls.push({ label, status: response.status, observedAt: new Date().toISOString(), headers });
    if (cost == null || !Number.isFinite(cost) || cost < 0) {
      report.issue = 'Missing trustworthy usage header; stopped without another request.'; save(); throw new Error(report.issue);
    }
    spent += cost;
    let body;
    try { body = await response.json(); } catch { save(); throw new Error('Non-JSON provider response; no retries.'); }
    if (!response.ok) { report.issue = `Provider HTTP ${response.status}; no retries.`; save(); throw new Error(report.issue); }
    writeFileSync(resolve(directory, `${label}.json`), JSON.stringify({ observedAt: calls.at(-1).observedAt, headers, data: body }, null, 2));
    save();
    if (cost > maximumCost || spent > 63) throw new Error('Provider charge exceeded expected cost; stopped.');
    return body;
  }
  try {
    const events = await request('/events', {}, 0, 'events');
    const event = events.filter(entry => /^[a-f0-9]{32}$/.test(entry.id) && Date.parse(entry.commence_time) > Date.now() + 15 * 60000)
      .sort((first, second) => Date.parse(first.commence_time) - Date.parse(second.commence_time))[0];
    if (!event) throw new Error('No upcoming NBA event at least 15 minutes from tipoff; no paid requests made.');
    report.event = event;
    const discovery = await request(`/events/${event.id}/markets`, { regions: 'us,us2' }, 1, 'discovery');
    if (discovery.id !== event.id) throw new Error('Discovery event identity mismatch; stopped.');
    const quotes = await request(`/events/${event.id}/odds`, { regions: 'us,us2', markets: markets.map(entry => entry.id).join(','), oddsFormat: 'american' }, 62, 'quotes');
    if (quotes.id !== event.id || quotes.sport_key !== 'basketball_nba'
      || Date.parse(quotes.commence_time) !== Date.parse(event.commence_time)) throw new Error('Quote event/tipoff identity mismatch; do not use receipt.');
    const observed = Date.parse(calls.at(-1).observedAt);
    report.coverage = markets.map(entry => {
      const advertisedBooks = (discovery.bookmakers ?? []).filter(book => book.markets?.some(market => market.key === entry.id)).map(book => book.key);
      const usable = [];
      for (const book of quotes.bookmakers ?? []) for (const market of book.markets ?? []) {
        if (market.key !== entry.id) continue;
        const updated = Date.parse(market.last_update ?? '');
        if (!Number.isFinite(updated) || updated > observed || observed - updated > 3600000) continue;
        for (const outcome of market.outcomes ?? []) {
          if (!Number.isInteger(outcome.price) || Math.abs(outcome.price) < 100) continue;
          const binary = ['player_double_double', 'player_triple_double'].includes(entry.id);
          const player = entry.id.startsWith('player_');
          if (player && !outcome.description?.trim()) continue;
          if (binary ? !['Yes', 'No'].includes(outcome.name)
            : entry.id.startsWith('h2h') ? ![event.home_team, event.away_team].includes(outcome.name)
              : !Number.isFinite(outcome.point) || (player || entry.id.includes('total')) && !['Over', 'Under'].includes(outcome.name)) continue;
          usable.push({ book: book.key, updatedAt: market.last_update, ...outcome });
        }
      }
      return { id: entry.id, label: entry.label, connection: entry.connection, advertisedBooks,
        pricedBooks: [...new Set(usable.map(outcome => outcome.book))], quoteCount: usable.length,
        status: usable.length ? 'CURRENT_QUOTES_OBSERVED' : advertisedBooks.length ? 'ADVERTISED_NO_CURRENT_QUOTES' : 'NOT_OBSERVED',
        examples: usable.slice(0, 3) };
    });
    report.completedAt = new Date().toISOString();
    save();
    console.log(JSON.stringify({ directory, ...report, creditsSpent: spent }, null, 2));
  } catch (error) {
    report.issue ??= error.message.includes(key) ? 'Probe failed; no retries.' : error.message;
    save();
    console.log(JSON.stringify({ directory, ...report, creditsSpent: spent }, null, 2));
    process.exitCode = 1;
  }
}