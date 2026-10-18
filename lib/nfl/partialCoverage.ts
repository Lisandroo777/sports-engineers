import { getNFLMarketMetadata } from './oddsTypes';
import { nflFreshnessMs } from './sportsbook';
import type { NFLSlateLedger } from './slateLedger';

export interface NFLResearchCoverageCandidate {
  gameId?: string | null;
  eventId?: string | null;
  marketKey?: string | null;
  retrievedAt?: string | null;
  sourceGameId?: string | null;
}

function isFreshRetrieval(value: string | null | undefined, kickoff: string, now: number): boolean {
  if (typeof value !== 'string') return false;
  const retrievedAt = Date.parse(value);
  return Number.isFinite(retrievedAt) && retrievedAt - now <= 60_000
    && now - retrievedAt <= nflFreshnessMs(kickoff, now);
}

function canonicalMarket(value: string | null | undefined): string | null {
  return typeof value === 'string' ? getNFLMarketMetadata(value)?.canonicalMarketKey ?? null : null;
}

export function isNFLGameResearchPublishable(
  ledger: NFLSlateLedger | null | undefined,
  candidate: NFLResearchCoverageCandidate,
  now = Date.now(),
): boolean {
  if (!ledger || ledger.sport !== 'nfl' || !Number.isFinite(now)
    || !candidate.gameId?.trim() || !candidate.eventId?.trim()
    || !Array.isArray(ledger.games) || !Array.isArray(ledger.requestedMarkets)) return false;

  const matches = ledger.games.filter((game) => game.gameId === candidate.gameId);
  if (matches.length !== 1) return false;
  const game = matches[0];
  const kickoff = Date.parse(game.kickoff);
  if (game.state !== 'RESEARCHED' || game.eligibility !== 'PREGAME' || game.failure !== null
    || !Number.isFinite(kickoff) || kickoff <= now
    || !isFreshRetrieval(game.retrievedAt, game.kickoff, now) || !isFreshRetrieval(candidate.retrievedAt, game.kickoff, now)
    || typeof game.expiresAt !== 'number' || !Number.isFinite(game.expiresAt) || game.expiresAt <= now
    || !game.eventId?.trim() || candidate.eventId !== game.eventId
    || !Array.isArray(game.returnedMarkets) || !Array.isArray(game.zeroMarkets)
    || !Array.isArray(game.failedMarkets) || game.failedMarkets.length !== 0) return false;

  if (candidate.sourceGameId != null && candidate.sourceGameId !== game.gameId
    && ledger.games.some((row) => row.gameId === candidate.sourceGameId)) return false;

  const market = canonicalMarket(candidate.marketKey);
  const requested = ledger.requestedMarkets.map(canonicalMarket);
  const returned = game.returnedMarkets.map(canonicalMarket);
  const zero = game.zeroMarkets.map(canonicalMarket);
  if (!market || requested.includes(null) || returned.includes(null) || zero.includes(null)
    || !requested.includes(market) || !returned.includes(market) || zero.includes(market)) return false;

  return requested.every((key) => returned.includes(key) || zero.includes(key));
}