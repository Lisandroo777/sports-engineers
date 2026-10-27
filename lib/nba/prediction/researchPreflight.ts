import type { OddsEvent } from '../../odds/types';
import { loadNBAResearchReceipt, nbaResearchMarketCoverage, NBA_VERIFIED_RESEARCH_MARKETS, type NBAResearchReceipt } from './researchReceipt';

export function planNBAResearch(events: OddsEvent[], selected: string[], receipts: Map<string, NBAResearchReceipt | null>, availableCredits: number, now = Date.now()) {
  const markets = NBA_VERIFIED_RESEARCH_MARKETS.filter(id => selected.includes(id));
  let remaining = availableCredits;
  const games = events.map(event => {
    if (!/^[a-f0-9]{32}$/.test(event.id) || !event.homeTeam || !event.awayTeam || event.homeTeam === event.awayTeam
      || !Number.isFinite(Date.parse(event.commenceTime)) || Date.parse(event.commenceTime) <= now) {
      return { eventId: event.id, homeTeam: event.homeTeam, awayTeam: event.awayTeam, markets: markets.map(id => ({ id,
        state: 'INVALID_EVENT' as const, needsRefresh: false })), refreshMarkets: [], expectedCredits: 0,
        allowed: false, status: 'EVENT_IDENTITY_INVALID' as const, reason: 'NBA event ID, team binding, or upcoming tipoff is invalid.' };
    }
    const coverage = nbaResearchMarketCoverage(receipts.get(event.id) ?? null,
      { id: event.id, tipoff: event.commenceTime, homeTeam: event.homeTeam, awayTeam: event.awayTeam }, markets, now);
    const refreshMarkets = coverage.filter(market => market.needsRefresh).map(market => market.id);
    const expectedCredits = refreshMarkets.length * 2;
    const allowed = expectedCredits <= remaining;
    if (allowed) remaining -= expectedCredits;
    return { eventId: event.id, homeTeam: event.homeTeam, awayTeam: event.awayTeam, markets: coverage,
      refreshMarkets, expectedCredits, allowed, status: !refreshMarkets.length ? 'CACHE_READY' : allowed ? 'REFRESH_PLANNED' : 'BUDGET_BLOCKED' };
  });
  return { availableCredits, expectedCredits: games.reduce((total, game) => total + game.expectedCredits, 0),
    reservedPlanCredits: availableCredits - remaining, completeWithinBudget: games.every(game => game.allowed), games };
}

export async function preflightNBAResearch(events: OddsEvent[], selected: string[], availableCredits: number) {
  const receipts = new Map(await Promise.all(events.map(async event => [event.id,
    /^[a-f0-9]{32}$/.test(event.id) ? await loadNBAResearchReceipt(event.id).catch(() => null) : null] as const)));
  return planNBAResearch(events, selected, receipts, availableCredits);
}