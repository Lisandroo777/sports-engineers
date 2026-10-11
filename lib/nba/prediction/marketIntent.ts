export type NBAGameLineMarket = 'MONEYLINE' | 'SPREAD' | 'FULL_GAME_TOTAL' | 'TEAM_TOTAL' | 'FIRST_HALF' | 'FIRST_QUARTER';

export interface NBAMarketIntent {
  gameLineMarkets: NBAGameLineMarket[];
  playerPropsRequested: boolean;
  allMarketsRequested: boolean;
  gameLinesOnly: boolean;
}

const GAME_LINE_PATTERNS: Array<[NBAGameLineMarket, RegExp]> = [
  ['MONEYLINE', /\b(?:money\s*lines?|ml|to\s+win(?:\s+the\s+game)?)\b/i],
  ['SPREAD', /\b(?:point\s+spread|spreads?|against\s+the\s+spread|ats|cover\s+the\s+spread)\b/i],
  ['TEAM_TOTAL', /\b(?:team\s+totals?|team\s+total\s+points?)\b/i],
  ['FIRST_HALF', /\b(?:first[-\s]+half|1st[-\s]+half|1h\s+(?:spread|total|line))\b/i],
  ['FIRST_QUARTER', /\b(?:first[-\s]+quarter|1st[-\s]+quarter|1q\s+(?:spread|total|line))\b/i],
  ['FULL_GAME_TOTAL', /\b(?:full[-\s]game\s+totals?|game\s+totals?|over\s*\/\s*under|o\s*\/\s*u)\b/i],
];
const ALL_GAME_LINE_MARKETS: NBAGameLineMarket[] = ['MONEYLINE', 'SPREAD', 'FULL_GAME_TOTAL', 'TEAM_TOTAL'];

export function classifyNBAMarketIntent(query: string): NBAMarketIntent {
  const normalized = query.toLowerCase();
  let gameLineMarkets = GAME_LINE_PATTERNS.filter(([, pattern]) => pattern.test(normalized)).map(([market]) => market);
  if (/\bnba\s+totals?\b/i.test(normalized) && !gameLineMarkets.includes('TEAM_TOTAL')) gameLineMarkets.push('FULL_GAME_TOTAL');
  if (/\bgame\s+lines?\b/i.test(normalized) && !gameLineMarkets.length) gameLineMarkets = ['MONEYLINE', 'SPREAD', 'FULL_GAME_TOTAL', 'TEAM_TOTAL'];
  if (gameLineMarkets.some(market => market === 'FIRST_HALF' || market === 'FIRST_QUARTER') && !/\bfull[-\s]game\b/i.test(normalized)) {
    gameLineMarkets = gameLineMarkets.filter(market => market === 'FIRST_HALF' || market === 'FIRST_QUARTER');
  }
  const playerPropsRequested = /\b(?:player\s+props?|props?|player\s+markets?)\b/i.test(normalized);
  const allMarketsRequested = /\b(?:across\s+all\s+markets|all\s+(?:nba\s+)?markets|everything|all\s+nba\s+picks|(?:best|top|most\s+likely|best\s+value)\s+nba\s+(?:picks?|plays?))\b/i.test(normalized);
  if (allMarketsRequested && gameLineMarkets.length === 0) gameLineMarkets = ALL_GAME_LINE_MARKETS;
  return { gameLineMarkets: [...new Set(gameLineMarkets)], playerPropsRequested, allMarketsRequested,
    gameLinesOnly: gameLineMarkets.length > 0 && !playerPropsRequested && !allMarketsRequested };
}

export function unsupportedNBAGameLineNotice(markets: NBAGameLineMarket[]): string {
  const labels: Record<NBAGameLineMarket, string> = {
    MONEYLINE: 'moneylines', SPREAD: 'spreads', FULL_GAME_TOTAL: 'full-game totals', TEAM_TOTAL: 'team totals',
    FIRST_HALF: 'first-half lines', FIRST_QUARTER: 'first-quarter lines',
  };
  const requested = [...new Set(markets)].map((market) => labels[market]);
  return `NBA ${requested.join(', ')} are not currently supported: no connected, timestamped sportsbook game-line quote and validated game-outcome probability model are available. No probability, fair odds, EV, or pick was invented.`;
}
