import { isPaidRefreshAllowed, withBoundedOddsRequest, withOneRunPaidRefresh, OddsRefreshNotAuthorizedError } from '../../odds/client';
import type { OddsEvent } from '../../odds/types';
import { NBA_VERIFIED_RESEARCH_MARKETS, loadNBAResearchReceipt, nbaResearchMarketCoverage, storeNBAResearchReceipt, type NBAResearchReceipt } from './researchReceipt';

export async function acquireNBAResearchReceipt(event: OddsEvent, requested: string[]): Promise<void> {
  const selected = NBA_VERIFIED_RESEARCH_MARKETS.filter(key => requested.includes(key));
  if (!selected.length) return;
  const expected = { id: event.id, tipoff: event.commenceTime, homeTeam: event.homeTeam, awayTeam: event.awayTeam };
  const cached = await loadNBAResearchReceipt(event.id);
  const markets = nbaResearchMarketCoverage(cached, expected, selected).filter(market => market.needsRefresh).map(market => market.id);
  if (!markets.length) return;
  if (!isPaidRefreshAllowed('nba')) throw new OddsRefreshNotAuthorizedError('NBA live research is disabled; cache-only research remains available.');
  if (!/^[a-f0-9]{32}$/.test(event.id) || !event.homeTeam || !event.awayTeam || event.homeTeam === event.awayTeam
    || !Number.isFinite(Date.parse(event.commenceTime)) || Date.parse(event.commenceTime) <= Date.now()) throw new Error('Exact upcoming NBA event required.');
  const path = `/sports/basketball_nba/events/${event.id}/odds`;
  const params = { regions: 'us,us2', markets: markets.join(','), oddsFormat: 'american' };
  const key = new URL(`https://api.the-odds-api.com/v4${path}`);
  Object.entries(params).forEach(([name, value]) => key.searchParams.set(name, value));
  const data = await withOneRunPaidRefresh(() => withBoundedOddsRequest(path, params, async () => {
    const afterLock = await loadNBAResearchReceipt(event.id);
    const outstanding = nbaResearchMarketCoverage(afterLock, expected, markets).filter(market => market.needsRefresh).map(market => market.id);
    if (!outstanding.length && afterLock) return { data: afterLock.data, credits: '0', remaining: null };
    const apiKey = process.env.THE_ODDS_API_KEY?.trim();
    if (!apiKey) throw new Error('Odds provider credential unavailable.');
    const url = new URL(key);
    url.searchParams.set('markets', outstanding.join(','));
    url.searchParams.set('apiKey', apiKey);
    let response: Response;
    try { response = await fetch(url, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(45000) }); }
    catch { throw new Error('NBA research quote transport failure; no automatic retry.'); }
    const credits = response.headers.get('x-requests-last');
    const remaining = response.headers.get('x-requests-remaining');
    if (!response.ok) { await response.body?.cancel(); throw new Error(`NBA research quotes unavailable (HTTP ${response.status}).`); }
    const data = await response.json() as NBAResearchReceipt['data'];
    await storeNBAResearchReceipt({ data, observedAt: new Date().toISOString(), requestedMarkets: outstanding, regions: ['us', 'us2'] });
    return { data, credits, remaining };
  }, { read: async () => {
    const current = await loadNBAResearchReceipt(event.id);
    return current && nbaResearchMarketCoverage(current, expected, markets).every(market => !market.needsRefresh) ? current.data : null;
  }, waitForShared: true }), { forceFresh: true, maxRequests: 1, maxCredits: markets.length * 2, allowedRequestKeys: [key.toString()], sport: 'nba' });
  void data;
}