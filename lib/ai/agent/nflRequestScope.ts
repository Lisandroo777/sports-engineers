import { NFL_ELITE_MARKETS, type NFLAnalyzableMarketKey } from '../../nfl/oddsTypes';
import { resolveDateFromText } from '../dateResolver';
import { parseNFLResearchIntent } from '../../nfl/researchIntent';

const NFL_TEAM_NAMES = [
  'Arizona Cardinals', 'Atlanta Falcons', 'Baltimore Ravens', 'Buffalo Bills', 'Carolina Panthers',
  'Chicago Bears', 'Cincinnati Bengals', 'Cleveland Browns', 'Dallas Cowboys', 'Denver Broncos',
  'Detroit Lions', 'Green Bay Packers', 'Houston Texans', 'Indianapolis Colts', 'Jacksonville Jaguars',
  'Kansas City Chiefs', 'Las Vegas Raiders', 'Los Angeles Chargers', 'Los Angeles Rams', 'Miami Dolphins',
  'Minnesota Vikings', 'New England Patriots', 'New Orleans Saints', 'New York Giants', 'New York Jets',
  'Philadelphia Eagles', 'Pittsburgh Steelers', 'San Francisco 49ers', 'Seattle Seahawks',
  'Tampa Bay Buccaneers', 'Tennessee Titans', 'Washington Commanders',
];

export type NFLMarketFamily = 'passing' | 'rushing' | 'receiving';

export interface NFLRequestScope {
  researchMode: import('../../nfl/researchIntent').NFLResearchMode;
  rankingIntent: import('../../nfl/researchIntent').NFLRankingIntent;
  lowThreshold: boolean;
  teams: string[];
  playerQuery: string | null;
  playerId: number | null;
  playerName: string | null;
  playerTeam: string | null;
  playerTeamId: number | null;
  marketFamily: NFLMarketFamily | null;
  marketKeys: NFLAnalyzableMarketKey[] | null;
  clarification: string | null;
}

export function nflNameMatches(query: string, name: string): boolean {
  const normalize = (value: string) => value.toLowerCase().replace(/['.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const requested = normalize(query);
  const full = normalize(name);
  return requested === full || requested === full.split(' ').at(-1);
}

export function parseNFLRequestScope(query: string): NFLRequestScope {
  const teams = NFL_TEAM_NAMES.filter((team) => {
    const nickname = team.split(' ').at(-1)!;
    return new RegExp(`\\b(?:${team}|${nickname})\\b`, 'i').test(query);
  });
  const marketFamily: NFLMarketFamily | null = /\b(?:passing|pass)\b/i.test(query) ? 'passing'
    : /\b(?:rushing|rush)\b/i.test(query) ? 'rushing'
    : /\b(?:receiving|reception|receptions)\b/i.test(query) ? 'receiving'
    : /\b(?:quarterback|qb)\b/i.test(query) ? 'passing' : null;
  const prefix = marketFamily === 'passing' ? 'player_pass_' : marketFamily === 'rushing' ? 'player_rush_' : 'player_reception';
  let name = query.match(/\b(?:props?|picks?|plays?)\s+(?:for|on)\s+(.+)$/i)?.[1]
    ?? query.match(/\b(?:best|top|show|find|give|only)\s+(.+?)\s+(?:props?|picks?|plays?)\b/i)?.[1] ?? '';
  const date = resolveDateFromText(query);
  if (date) name = name.replace(new RegExp(date.rawDateText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
  for (const team of teams) name = name.replace(new RegExp(`\\b(?:${team}|${team.split(' ').at(-1)})\\b`, 'gi'), ' ');
  name = name
    .replace(/\b(?:low[-\s]threshold|low(?:er)?\s+lines?|deep(?:ly)?\s+research|deep\s+dive|full\s+(?:deep\s+)?research|research\s+(?:this\s+)?deeply|in[-\s]depth\s+(?:research|analysis)|comprehensive\s+(?:research|analysis)|thorough(?:ly)?\s+(?:research|analysis)|[23][-\s]man)\b/gi, ' ')
    .replace(/\b(?:under|below|over|above|around|near|at)\s*[+-]\d{2,4}\b/gi, ' ')
    .replace(/\b(?:me|you|the|best|top|all|only|show|give|closest|misses|rejected|passes|pass|nukes?|elite|sharps?|edges?|leans?|or|better|why|qualify|qualified|everything|like|most|likely|probability|chance|vs|versus|at|higher|value|payout|safer|safest|strongest|favorite|favourite|nfl|football|player|players|quarterback|quarterbacks|qb|running|backs?|receivers?|wide|tight|ends?|passing|rushing|rush|receiving|receptions?|yards?|attempts?|completions?|touchdowns?|tds?|interceptions?|overs?|unders?|today|tonight|tomorrow|this|next|sunday|monday|tuesday|wednesday|thursday|friday|saturday|night|for)\b/gi, ' ')
    .replace(/\b\d+\b/g, ' ').replace(/\s+/g, ' ').trim();
  return {
    ...parseNFLResearchIntent(query),
    teams, playerQuery: name || null, playerId: null, playerName: null, playerTeam: null, playerTeamId: null,
    marketFamily, marketKeys: marketFamily ? NFL_ELITE_MARKETS.filter((market) => market.startsWith(prefix)) : null,
    clarification: null,
  };
}