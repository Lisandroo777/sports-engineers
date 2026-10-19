import { detectSport, type SupportedSport } from '../lib/ai/sportResearchAdapters';
import { resolveDateFromText } from '../lib/ai/dateResolver';
import { parseNFLRequestScope, nflNameMatches } from '../lib/ai/agent/nflRequestScope';
import type { ResearchCandidateRecord } from '../lib/ai/agent/session';
import { getNFLUnsupportedFieldGoalConcept } from '../lib/nfl/oddsTypes';

export interface BettingIntent {
  sport: SupportedSport | null;
  date: string | null;
  games: string[];
  teams: string[];
  players: string[];
  markets: string[];
  position: string | null;
  directions: Array<'over' | 'under'>;
  researchMode: 'STANDARD' | 'DEEP';
  rankingIntent: 'BEST' | 'MOST_LIKELY' | 'BEST_VALUE';
  requestedCount: number;
  countRequested?: boolean;
  requestedTiers: string[];
  oddsConstraints: { min: number | null; max: number | null };
  linePreference: 'LOW_THRESHOLD' | null;
  combinationIntent: boolean;
  comparisonIntent: boolean;
  explanationIntent: boolean;
  followUpIntent: boolean;
  referenceIds: string[];
  pregameOnly: boolean;
  action: 'PICKS' | 'EXPLAIN' | 'COMPARE' | 'EDUCATION' | 'OUT_OF_SCOPE' | 'CLARIFY' | 'INTERPRET';
  clarification: string | null;
  unsupportedMarket: string | null;
  changedDimensions: string[];
}
export interface BettingConversation {
  intent: BettingIntent;
  displayedIds: string[];
  referencedIds: string[];
}
const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const numberPattern = '(one|two|three|four|five|six|seven|eight|nine|ten|\\d{1,2})';
const countValue = (text: string) => WORD_NUMBERS[text] ?? Number(text);
export function isMLBGameMarketRequest(query: string): boolean {
  return /\b(?:money\s*lines?|run[- ]?lines?|spreads?|(?:team|game) totals?|game lines?|f5|first[- ](?:5|five)(?:[- ]innings?)?|nrfi|yrfi|(?:no|yes) runs? (?:in (?:the )?)?first inning|totals?(?!\s+bases))\b/i.test(query);
}

export function requestedMLBTeams(query: string): string[] {
  const teams = [
    ['Arizona Diamondbacks', 'ARI', 'Dbacks'], ['Atlanta Braves', 'ATL'], ['Baltimore Orioles', 'BAL'],
    ['Boston Red Sox', 'BOS'], ['Chicago Cubs', 'CHC'], ['Chicago White Sox', 'CWS', 'CHW'],
    ['Cincinnati Reds', 'CIN'], ['Cleveland Guardians', 'CLE'], ['Colorado Rockies', 'COL'],
    ['Detroit Tigers', 'DET'], ['Houston Astros', 'HOU'], ['Kansas City Royals', 'KC', 'KCR'],
    ['Los Angeles Angels', 'LAA'], ['Los Angeles Dodgers', 'LAD'], ['Miami Marlins', 'MIA'],
    ['Milwaukee Brewers', 'MIL'], ['Minnesota Twins', 'MIN'], ['New York Mets', 'NYM'],
    ['New York Yankees', 'NYY'], ['Athletics', 'OAK', 'ATH', 'Oakland Athletics'], ['Philadelphia Phillies', 'PHI'],
    ['Pittsburgh Pirates', 'PIT'], ['San Diego Padres', 'SD', 'SDP'], ['San Francisco Giants', 'SF', 'SFG'],
    ['Seattle Mariners', 'SEA'], ['St. Louis Cardinals', 'STL'], ['Tampa Bay Rays', 'TB', 'TBR'],
    ['Texas Rangers', 'TEX'], ['Toronto Blue Jays', 'TOR'], ['Washington Nationals', 'WSH', 'WAS'],
  ];
  return teams.filter(([name, ...aliases]) => {
    const nickname = /(?:Red Sox|White Sox|Blue Jays)$/.exec(name)?.[0] ?? name.split(' ').at(-1)!;
    return [name, nickname, ...aliases].some(alias => new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(query));
  }).map(([name]) => name);
}

export function emptyIntent(): BettingIntent {
  return { sport: null, date: null, games: [], teams: [], players: [], markets: [], position: null, directions: [],
    researchMode: 'STANDARD', rankingIntent: 'BEST', requestedCount: 15, requestedTiers: [], oddsConstraints: { min: null, max: null },
    linePreference: null, combinationIntent: false, comparisonIntent: false, explanationIntent: false, followUpIntent: false,
    referenceIds: [], pregameOnly: true, action: 'PICKS', clarification: null, unsupportedMarket: null, changedDimensions: [] };
}
export function interpretBettingIntent(query: string, candidates: ResearchCandidateRecord[] = [], previous?: BettingConversation | null, sportHint?: SupportedSport | null): BettingIntent {
  const text = query.toLowerCase().replace(/[’]/g, "'")
    .replace(/([a-z])[-\u2010-\u2013](?=[a-z])/g, '$1 ')
    .replace(/(\d)-(?=(?:man|leg)\b)/g, '$1 ');
  const explicitSport = detectSport(text);
  const scope = parseNFLRequestScope(query);
  const explicitDate = /\b(?:today|tonight|tomorrow|yesterday|sunday|monday|tuesday|wednesday|thursday|friday|saturday|\d{4}-\d{2}-\d{2})\b/.test(text) ? resolveDateFromText(text)?.resolvedDate ?? null : null;
  const fresh = !previous || explicitSport != null && explicitSport !== previous.intent.sport
    || explicitDate != null && previous.intent.date != null && explicitDate !== previous.intent.date
    || explicitSport != null && !scope.teams.length && !scope.playerQuery && /\b(?:best|top|all|entire|whole)\b/.test(text)
    || /\b(?:start over|new search|reset filters|all games|whole slate)\b/.test(text);
  const intent: BettingIntent = fresh ? emptyIntent() : structuredClone(previous.intent);
  intent.changedDimensions = [];
  intent.referenceIds = [];
  intent.comparisonIntent = /\b(?:compare|which (?:one )?is (?:better|safer)|which (?:one )?has more value)\b/.test(text) || /\bversus\b/.test(text) && !scope.teams.length || /\bor\b/.test(text) && candidates.filter((row) => text.includes(row.player.toLowerCase().split(' ').at(-1)!)).length >= 2;
  intent.explanationIntent = /^(?:why\??|what'?s the risk\??)$/.test(text.trim()) || /\b(?:why|explain|risk|makes (?:this|it).*elite|could.*lose|matchup look|done recently|his role|the injury|think about.*line)\b/.test(text);
  intent.combinationIntent = /\b(?:parlay|slip|combo|(?:[2-9]|two|three|four|five)[ -](?:man|leg))\b/.test(text) || !fresh && previous!.intent.combinationIntent;
  intent.followUpIntent = !fresh;
  intent.clarification = null;
  intent.unsupportedMarket = null;
  intent.action = intent.comparisonIntent ? 'COMPARE' : intent.explanationIntent ? 'EXPLAIN' : 'PICKS';
  const set = <Key extends keyof BettingIntent>(key: Key, value: BettingIntent[Key]) => { intent[key] = value; intent.changedDimensions.push(key); };
  set('sport', explicitSport ?? intent.sport ?? (scope.teams.length || /\b(?:qb|quarterback|nfl|football|saints|falcons|bijan|olave|shough)\b/.test(text) ? 'nfl' : sportHint ?? null));
  if (explicitDate) set('date', explicitDate);
  const names = [...new Set(candidates.map((row) => row.player))];
  const mentioned = names.filter((name) => name.split(' ').filter((token) => token.length >= 3).some((token) => new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(query)) || text.includes(name.toLowerCase()));
  const playerPrefix = query.match(/\b(?:anything|plays?|props?|picks?)\s+(?:for|on)\s+([a-z][a-z .'-]+?)(?:[?!]|$)/i)?.[1]
    ?? query.match(/\b(?:why do you like|what do you like for|go deeper on|best)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)(?:\s+(?:play|props?|pick)|[?!]|$)/i)?.[1]
    ?? query.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+props?\b/i)?.[1];
  if (mentioned.length) set('players', mentioned);
  else if (playerPrefix && !/\b(?:this|one|two|three|four|five|first|second|third|game|tonight|today|me|nfl|football|the|some|best|plays|props|picks|passing|receiving|rushing|qb|rb|wr|te)\b/i.test(playerPrefix)) set('players', [playerPrefix.trim()]);
  else if (/^(?:best|top|show|find)\s/i.test(query) && /\bprops?\b/i.test(query) && scope.playerQuery) set('players', [scope.playerQuery]);
  if (scope.teams.length) { set('teams', scope.teams); set('games', []); }
  else if (/\batlanta\b/.test(text) || /\bnew orleans\b/.test(text)) { set('teams', [ ...(/\batlanta\b/.test(text) ? ['Atlanta Falcons'] : []), ...(/\bnew orleans\b/.test(text) ? ['New Orleans Saints'] : []) ]); set('sport', 'nfl'); }
  const marketRules: Array<[RegExp, string[]]> = [
    ...(intent.sport === 'nfl' ? [[/\b(?:fgs?|field[\s-]*goals?|kicking[\s-]*points?|kickers?)\b/, scope.marketKeys ?? []] as [RegExp, string[]]] : []),
    [/\breceptions?\b/, ['player_receptions']], [/\breceiving\s+(?:yards?|lines?)\b/, ['player_reception_yds']],
    [/\bpassing\s+(?:yards?|lines?)\b/, ['player_pass_yds']], [/\bcompletions?\b/, ['player_pass_completions']],
    [/\b(?:pass|passing)\s+attempts?\b/, ['player_pass_attempts']], [/\brushing\s+yards?\b/, ['player_rush_yds']],
    [/\b(?:rush|rushing)\s+attempts?|\bcarries\b/, ['player_rush_attempts']],
    [/\b(?:td|touchdown)\s+props?\b/, ['player_anytime_td', 'player_pass_tds', 'player_rush_tds', 'player_reception_tds']],
    [/\bpassing\s+props?\b/, ['player_pass_yds', 'player_pass_attempts', 'player_pass_completions', 'player_pass_tds', 'player_pass_interceptions']],
    [/\breceiving\s+(?:props?|plays?|picks?)\b/, ['player_reception_yds', 'player_receptions', 'player_reception_tds']],
    [/\b(?:only receiving|receiving only)\b/, ['player_reception_yds', 'player_receptions', 'player_reception_tds']],
  ];
  const market = marketRules.find(([pattern]) => pattern.test(text));
  if (market) set('markets', market[1]);
  if (intent.sport === 'nfl' && scope.marketKeys?.some((key) => key === 'player_field_goals' || key === 'player_kicking_points')) {
    if (!mentioned.length && playerPrefix) set('players', scope.playerQuery ? [scope.playerQuery] : []);
  }
  if (/\blow receiving lines?\b/.test(text)) set('markets', ['player_reception_yds', 'player_receptions']);
  const position = /\b(?:qb|quarterback)\s+props?\b/.test(text) ? 'QB' : /\b(?:rb|running back)\s+props?\b/.test(text) ? 'RB' : /\b(?:wr|wide receiver)\s+props?\b/.test(text) ? 'WR' : /\bte\s+props?\b/.test(text) ? 'TE' : null;
  if (position) set('position', position);
  if (/\b(?:unders?|overs?)\b/.test(text) && !/\b(?:over|under)\s*[+-]\d/.test(text)) set('directions', /\bunders?\b/.test(text) ? ['under'] : ['over']);
  if (/\b(?:deep(?:ly)?\s+research|deep dive|full(?: deep)? research|maximum research|go deeper|research (?:this )?deeply)\b/.test(text)) set('researchMode', 'DEEP');
  else if (/\bstandard(?: research)?\b/.test(text)) set('researchMode', 'STANDARD');
  const valueRequest = /\b(?:best value|most value|highest value|best ev|most edge|best price|where'?s the (?:value|edge)|more value)\b/.test(text);
  if (valueRequest) set('rankingIntent', 'BEST_VALUE');
  else if (/\b(?:safest|safer|most likely|highest probability|most confident|most probable|trust (?:the )?most)\b/.test(text)) set('rankingIntent', 'MOST_LIKELY');
  else if (/\b(?:best|favorite|favourite|top|what do you like|what are you on|your picks)\b/.test(text)) set('rankingIntent', 'BEST');
  if (/\b(?:low[- ]threshold|low(?:er)?\s+(?:\w+\s+)?lines?|easy lines?|small number|low yardage|low receptions|low passing line)\b/.test(text)) set('linePreference', 'LOW_THRESHOLD');
  const count = text.match(new RegExp(`\\b(?:give me(?: your| the)?(?: (?:best(?: value)?|safest|favorite))?|make it|top|best(?: value)?|safest|most likely|highest probability|build me(?: a)?|which)\\s+${numberPattern}\\b`))
    ?? text.match(new RegExp(`\\b${numberPattern}\\s*(?:picks?|plays?|props?|legs?|man)\\b`));
  if (count) {
    set('requestedCount', intent.sport === 'nfl' || intent.sport === 'nba' ? Math.max(1, countValue(count[1])) : Math.min(15, Math.max(1, countValue(count[1]))));
    intent.countRequested = true;
  }
  else if (/\b(?:best play|best pick|favorite(?: pick| play)?|top pick|best one|which one|safest pick|trust.*most)\b/.test(text)) { set('requestedCount', 1); intent.countRequested = true; }
  if (/\beverything you like\b/.test(text)) { set('requestedCount', 15); intent.countRequested = false; }
  if (/\b(?:nukes?|elite|sharp|edge|lean)\b/.test(text) && !intent.explanationIntent && !valueRequest) {
    const tier = text.match(/\b(nukes?|elite|sharp|edge|lean)\b/)![1].replace(/s$/, '').toUpperCase();
    const order = ['NUKE', 'ELITE', 'SHARP', 'EDGE', 'LEAN'];
    set('requestedTiers', /\b(?:or better|and above|\+)\b/.test(text) ? order.slice(0, order.indexOf(tier) + 1) : [tier]);
  }
  const range = text.match(/\bbetween\s*([+-]\d{2,4})\s*(?:and|to)\s*([+-]\d{2,4})/);
  if (range) set('oddsConstraints', { min: Math.min(Number(range[1]), Number(range[2])), max: Math.max(Number(range[1]), Number(range[2])) });
  else if (/\b(?:plus money|no juice)\b/.test(text)) set('oddsConstraints', { min: 100, max: null });
  else {
    const floor = text.match(/(?:nothing worse than|anything worse than|no worse than|don'?t.*?(?:over|worse than)|not.*?worse than)\s*(-\d{2,4})/)
      ?? text.match(/(-\d{2,4})\s+or better/);
    if (floor) set('oddsConstraints', { min: Number(floor[1]), max: null });
    else if (/\b(?:under|over|below|above)\s*-\d{2,4}/.test(text)) intent.clarification = 'Do you mean that price or better value, or that price or shorter odds?';
  }
  const displayed = previous?.displayedIds ?? [];
  const ordinal = text.match(/\b(?:number\s*|#)(\d{1,2})\b/) ?? text.match(/\b(first|second|third|fourth|fifth)\s+(?:one|play|pick)?\b/);
  const ordinalValue = ordinal ? /^\d+$/.test(ordinal[1]) ? Number(ordinal[1]) : ['first', 'second', 'third', 'fourth', 'fifth'].indexOf(ordinal[1]) + 1 : null;
  if (ordinalValue != null) {
    const id = displayed[ordinalValue - 1];
    if (id) intent.referenceIds = [id]; else intent.clarification = `Which play do you mean by number ${ordinalValue}?`;
  } else if (/\b(?:this one|that play|this play|the passing play|the olave one|him|he|those two|these two|compare it|(?:this|that) (?:game|matchup))\b/.test(text)) {
    let matches = displayed;
    if (/\b(?:him|he)\b/.test(text) && previous?.referencedIds.length === 1) matches = previous.referencedIds;
    if (/passing play/.test(text)) matches = displayed.filter((id) => candidates.find((row) => row.candidateId === id)?.marketKey.startsWith('player_pass_'));
    if (/olave one/.test(text)) matches = displayed.filter((id) => candidates.find((row) => row.candidateId === id)?.player.includes('Olave'));
    if (/compare it/.test(text)) matches = previous?.referencedIds ?? [];
    if (/those two|these two/.test(text) && matches.length === 2) intent.referenceIds = matches;
    else if (/\b(?:this|that) (?:game|matchup)\b/.test(text) && !scope.teams.length) {
      const games = [...new Set(matches.map((id) => candidates.find((row) => row.candidateId === id)?.gameId).filter((value): value is string => Boolean(value)))];
      if (games.length === 1) set('games', games); else intent.clarification = 'Which game do you mean?';
    } else if (/\b(?:this|that) (?:game|matchup)\b/.test(text) && scope.teams.length) {
      intent.referenceIds = [];
    } else if (matches.length === 1) intent.referenceIds = matches;
    else intent.clarification = 'Which play do you mean?';
  }
  if (intent.comparisonIntent && ordinalValue != null && /compare it/.test(text)) intent.referenceIds = [...new Set([...(previous?.referencedIds ?? []), ...intent.referenceIds])];
  if (intent.explanationIntent && !intent.referenceIds.length && !intent.players.length) {
    if (displayed.length === 1) intent.referenceIds = displayed; else if (displayed.length > 1) intent.clarification = 'Which play would you like me to explain?';
  }
  if (intent.referenceIds.length && intent.researchMode === 'DEEP' && !intent.comparisonIntent && !intent.explanationIntent) set('requestedCount', 1);
  if (/\b(?:moneylines?|spreads?|(?:team|game) totals?|game lines?|first[- ]half|first[- ]quarter)\b/.test(text)) intent.unsupportedMarket = text.match(/\b(?:moneylines?|spreads?|(?:team|game) totals?|game lines?|first[- ]half|first[- ]quarter)\b/)![0];
  if (intent.sport === 'mlb' && isMLBGameMarketRequest(text)) intent.unsupportedMarket = null;
  const betting = /\b(?:picks?|plays?|props?|bets?|betting|odds|lines?|parlay|slip|juice|moneyline|spread|total|ev|edge|research|matchup|injury|weather|news|football|nfl|nba|mlb|probability|overs?|unders?|receptions?|passing|receiving|safest|favorite|value|nukes?|elite)\b/.test(text) || mentioned.length || scope.teams.length || intent.sport === 'mlb' && isMLBGameMarketRequest(text);
  const conversational = /^(?:give me|make it|only|which|why|go deeper|compare|safest|most likely|what.*(?:risk|favorite|like|trust|on))/.test(text) || /[+-]\d{2,4}/.test(text);
  if (/\b(?:write.*(?:poem|code)|recipe|capital of|solve.*equation|politics|vacation|javascript|python)\b/.test(text) || !betting && !((previous || sportHint) && conversational)) intent.action = 'OUT_OF_SCOPE';
  if (/\b(?:what (?:is|does)|explain|how does)\b/.test(text) && /\b(?:ev|odds|vig|juice|parlay|moneyline|spread|kelly|probability|betting)\b/.test(text) && !intent.referenceIds.length) intent.action = 'EDUCATION';
  if (/\b(?:supported sports|sports do you|supported markets|markets do you|previous picks|pick results|betting strategy|sportsbook comparison)\b/.test(text)) intent.action = 'EDUCATION';
  if (intent.action === 'OUT_OF_SCOPE' && (previous || sportHint || explicitSport) && !/\b(?:write|recipe|capital|equation|politics|vacation|javascript|python|poem|song)\b/.test(text)) intent.action = 'INTERPRET';
  if (/\b(?:anything.*left|haven'?t started|still play)\b/.test(text)) { intent.action = 'PICKS'; intent.pregameOnly = true; }
  if (intent.clarification) intent.action = 'CLARIFY';
  if (mentioned.length > 1 && !intent.comparisonIntent) { intent.action = 'CLARIFY'; intent.clarification = `Which player do you mean: ${mentioned.join(' or ')}?`; }
  if (intent.action === 'PICKS' && !intent.sport && !previous) { intent.action = 'CLARIFY'; intent.clarification = 'Which sport or game would you like picks for?'; }
  if (intent.action === 'PICKS' && intent.players.length && !mentioned.length && candidates.length && !candidates.some((row) => intent.players.some((name) => nflNameMatches(name, row.player)))) intent.referenceIds = [];
  if (intent.sport === 'nfl' && scope.clarification) {
    intent.unsupportedMarket = getNFLUnsupportedFieldGoalConcept(query);
    set('markets', []);
    intent.clarification = scope.clarification;
    intent.action = 'CLARIFY';
  }
  return intent;
}