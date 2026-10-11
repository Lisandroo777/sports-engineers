export const NBA_ACTIVATION_MARKETS = 'player_points,player_rebounds,player_assists,h2h,spreads,totals,team_totals';

export function nbaActivationCacheKey(eventId: string): string {
  const url = new URL(`https://api.the-odds-api.com/v4/sports/basketball_nba/events/${encodeURIComponent(eventId)}/odds`);
  url.searchParams.set('regions', 'us');
  url.searchParams.set('markets', NBA_ACTIVATION_MARKETS);
  url.searchParams.set('oddsFormat', 'american');
  return url.toString();
}