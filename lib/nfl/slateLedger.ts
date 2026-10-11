import type { NFLGame } from './types';
import type { NFLAnalyzableMarketKey } from './oddsTypes';
import type { NFLProviderFailure } from './sportsbook';

export interface NFLGameLedger {
  gameId: string;
  matchup: string;
  kickoff: string;
  eligibility: 'PREGAME' | 'STARTED' | 'FINAL' | 'EXCLUDED';
  state: 'NOT_FETCHED' | 'SPORTSBOOK_AVAILABLE' | 'ZERO_MARKETS' | 'RESEARCHED' | 'FAILED';
  eventId: string | null;
  returnedMarkets: NFLAnalyzableMarketKey[];
  zeroMarkets: NFLAnalyzableMarketKey[];
  failedMarkets: NFLAnalyzableMarketKey[];
  retrievedAt: string | null;
  expiresAt: number | null;
  failure: NFLProviderFailure | null;
  propsEvaluated: number;
  fromCache: boolean;
}
export interface NFLSlateLedger {
  sport: 'nfl';
  date: string;
  requestedMarkets: NFLAnalyzableMarketKey[];
  games: NFLGameLedger[];
  expectedGames: number;
  eligiblePregame: number;
  started: number;
  final: number;
  excluded: number;
  retrievedGames: number;
  zeroMarketGames: number;
  researchedGames: number;
  failedGames: number;
  notFetchedGames: number;
  researchComplete: boolean;
}

export function createNFLSlateLedger(games: NFLGame[], date: string, requestedMarkets: NFLAnalyzableMarketKey[], now = Date.now()): NFLSlateLedger {
  return finishNFLSlateLedger({ sport: 'nfl', date, requestedMarkets, games: games.map((game) => ({
    gameId: game.id, matchup: `${game.awayTeam.displayName} @ ${game.homeTeam.displayName}`, kickoff: game.gameTime,
    eligibility: game.completed ? 'FINAL' : /postponed|cancelled|canceled|suspended/i.test(game.status ?? '') ? 'EXCLUDED'
      : Date.parse(game.gameTime) <= now ? 'STARTED' : Number.isFinite(Date.parse(game.gameTime)) ? 'PREGAME' : 'EXCLUDED',
    state: 'NOT_FETCHED', eventId: null, returnedMarkets: [], zeroMarkets: [], failedMarkets: [], retrievedAt: null,
    expiresAt: null, failure: null, propsEvaluated: 0, fromCache: true,
  })) });
}

export function finishNFLSlateLedger(ledger: Pick<NFLSlateLedger, 'sport' | 'date' | 'requestedMarkets' | 'games'>): NFLSlateLedger {
  const eligible = ledger.games.filter((game) => game.eligibility === 'PREGAME');
  return { ...ledger, expectedGames: ledger.games.length, eligiblePregame: eligible.length,
    started: ledger.games.filter((game) => game.eligibility === 'STARTED').length,
    final: ledger.games.filter((game) => game.eligibility === 'FINAL').length,
    excluded: ledger.games.filter((game) => game.eligibility === 'EXCLUDED').length,
    retrievedGames: eligible.filter((game) => game.retrievedAt != null && game.failure == null).length,
    zeroMarketGames: eligible.filter((game) => game.state === 'ZERO_MARKETS').length,
    researchedGames: eligible.filter((game) => game.state === 'RESEARCHED').length,
    failedGames: eligible.filter((game) => game.state === 'FAILED').length,
    notFetchedGames: eligible.filter((game) => game.state === 'NOT_FETCHED').length,
    researchComplete: eligible.every((game) => game.state === 'RESEARCHED'),
  };
}