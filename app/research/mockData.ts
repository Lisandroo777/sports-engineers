export type ConfidenceLabel = "Strong" | "Good" | "Moderate";
export type Side = "Over" | "Under";

export interface GameLogEntry {
  date: string;
  opponent: string;
  statResult: string;
  hit: boolean;
  homeAway: "Home" | "Away";
  playerStat: number;
  actualStatResult?: string;
  teamScore?: number;
  opponentScore?: number;
  plateAppearances?: number;
  hits?: number;
  extraBaseHits?: number;
  runs?: number;
  rbi?: number;
  totalBases?: number;
}

export interface ResearchFactor {
  label: string;
  detail: string;
  impact: "positive" | "neutral" | "negative";
}

export interface PropResearchItem {
  id: string;
  isLive?: boolean;
  /** Canonical market key for the exact prop this row represents (live rows only). */
  marketKey?: string;
  hasSportsbookLine?: boolean;
  sportsbookName?: string;
  oddsLastUpdate?: string;
  sport: string;
  player: string;
  playerId?: number;
  playerImageUrl?: string;
  team: string;
  teamId?: number;
  teamLogoUrl?: string;
  opponent: string;
  rationale?: string;
  temperature?: string;
  homeAway?: 'Home' | 'Away';
  propType: string;
  line: string;
  overOdds: string;
  underOdds: string;
  projectedValue: number;
  confidence: number;
  confidenceLabel: ConfidenceLabel;
  gameTime: string;
  researchSide: Side;
  projectedPlateAppearances?: number;
  projectedBattingOrder?: number;
  last5: string;
  last10: string;
  last20: string;
  last40: string;
  season: string;
  hitRates: {
    last5: number;
    last10: number;
    last20: number;
    last40: number;
    season: number;
  };
  gameLog: GameLogEntry[];
  splits: {
    home: string;
    away: string;
    similarOpponents: string;
    recent5: string;
    recent10: string;
  };
  matchup: {
    opponentDefensiveRanking: string;
    opponentAllowedAverage: string;
    paceEnvironment: string;
    difficulty: string;
    recentHistory: string;
  };
  researchFactors: ResearchFactor[];
  aiAnalysis: {
    summary: string;
    risks: string;
    lean: string;
  };
  startingPitchers?: {
    away: { name: string; image?: string; teamLogo?: string; hand: string; era: string; whip: string; kRate: string; bbRate: string; hrPer9: string; baa: string };
    home: { name: string; image?: string; teamLogo?: string; hand: string; era: string; whip: string; kRate: string; bbRate: string; hrPer9: string; baa: string };
  };
  bullpen?: {
    away: { era: string; whip: string; kRate: string; bbRate: string; hrPer9: string; fip: string; recentUsage: string };
    home: { era: string; whip: string; kRate: string; bbRate: string; hrPer9: string; fip: string; recentUsage: string };
  };
  lineup?: {
    away: Array<{ player: string; image?: string; order: number; avg: string; obp: string; slg: string; ops: string; hr: number; rbi: number; hand: string }>;
    home: Array<{ player: string; image?: string; order: number; avg: string; obp: string; slg: string; ops: string; hr: number; rbi: number; hand: string }>;
  };
  weather?: {
    temperature: string;
    conditions: string;
    windSpeed: string;
    windDirection: string;
    humidity: string;
    rainChance: string;
  };
  stadium?: {
    name: string;
    city: string;
    parkFactor: string;
  };
  teamRecord?: {
    away: { name: string; overall: string; home: string; away: string; last10: string };
    home: { name: string; overall: string; home: string; away: string; last10: string };
  };
  matchupStats?: {
    awayVsRHP: { avg: string; obp: string; slg: string; ops: string; kRate: string; bbRate: string; hrRate: string };
    homeVsLHP: { avg: string; obp: string; slg: string; ops: string; kRate: string; bbRate: string; hrRate: string };
  };
}

export const sportFilters = ["All", "NBA", "NFL", "MLB", "NHL", "Soccer", "UFC"];

export interface ResearchMarketMover {
  id: string;
  player: string;
  playerId?: number;
  teamId?: number;
  prop: string;
  openingOdds: string;
  currentOdds: string;
  direction: 'up' | 'down';
  movement: string;
}

export const researchMarketMovers: ResearchMarketMover[] = [
  { id: 'm1', player: 'Juan Soto', playerId: 665742, teamId: 147, prop: 'Over 1.5 TB', openingOdds: '+110', currentOdds: '-135', direction: 'down', movement: '-0.5' },
  { id: 'm2', player: 'Rafael Devers', playerId: 646240, teamId: 111, prop: 'Over 0.5 HR', openingOdds: '+100', currentOdds: '-125', direction: 'down', movement: '-0.4' },
  { id: 'm3', player: 'Pete Alonso', playerId: 624413, teamId: 121, prop: 'Over 0.5 HR', openingOdds: '+100', currentOdds: '+120', direction: 'up', movement: '+0.4' },
  { id: 'm4', player: 'Corbin Carroll', playerId: 682998, teamId: 109, prop: 'Over 1.5 TB', openingOdds: '+100', currentOdds: '+105', direction: 'up', movement: '+0.3' },
  { id: 'm5', player: 'Gunnar Henderson', playerId: 683002, teamId: 110, prop: 'Over 1.5 TB', openingOdds: '+100', currentOdds: '-110', direction: 'down', movement: '-0.3' },
];

export const researchQuickPlayers = [
  { id: 'p1', name: 'Aaron Judge', playerId: 592450, team: 'Yankees', teamId: 147, position: 'OF' },
  { id: 'p2', name: 'Shohei Ohtani', playerId: 660271, team: 'Dodgers', teamId: 119, position: 'DH' },
  { id: 'p3', name: 'Juan Soto', playerId: 665742, team: 'Yankees', teamId: 147, position: 'OF' },
  { id: 'p4', name: 'Mookie Betts', playerId: 605141, team: 'Dodgers', teamId: 119, position: 'RF' },
  { id: 'p5', name: 'Julio Rodriguez', playerId: 677594, team: 'Mariners', teamId: 136, position: 'OF' },
];

function parseLineNumber(line: string) {
  const parsed = Number.parseFloat(line);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseStatValue(statResult: string) {
  const parsed = Number.parseFloat(statResult.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function evaluateOutcome(statResult: string, propLine: string, side: Side) {
  const lineNumber = parseLineNumber(propLine);
  const statValue = parseStatValue(statResult);

  if (lineNumber === null || statValue === null) {
    return false;
  }

  return side === "Over" ? statValue > lineNumber : statValue < lineNumber;
}

export function calculateHitRate(gameLogs: GameLogEntry[], propLine: string, windowSize: number, side: Side) {
  const relevantLogs = gameLogs.slice(-windowSize);

  if (relevantLogs.length === 0) {
    return 0;
  }

  const hits = relevantLogs.filter((entry) => entry.hit).length;
  return Math.round((hits / relevantLogs.length) * 100);
}

const buildGameLog = (propType: string, opponent: string, line: string, side: Side) => {
  const statTemplates: Record<string, string[]> = {
    Points: ["32 pts", "28 pts", "30 pts", "34 pts", "29 pts", "31 pts", "27 pts", "33 pts", "35 pts", "26 pts"],
    Assists: ["10 ast", "8 ast", "9 ast", "11 ast", "7 ast", "12 ast", "10 ast", "8 ast", "9 ast", "11 ast"],
    "Receiving Yards": ["112 yds", "97 yds", "104 yds", "118 yds", "88 yds", "101 yds", "107 yds", "93 yds", "110 yds", "99 yds"],
    Hits: ["2 hits", "3 hits", "1 hit", "2 hits", "3 hits", "2 hits", "1 hit", "3 hits", "2 hits", "1 hit"],
    Goals: ["2 goals", "1 goal", "3 goals", "2 goals", "1 goal", "2 goals", "1 goal", "3 goals", "2 goals", "1 goal"],
    Shots: ["6 shots", "5 shots", "7 shots", "4 shots", "6 shots", "5 shots", "8 shots", "6 shots", "4 shots", "7 shots"],
    HomeRuns: ["1 HR", "2 HR", "0 HR", "1 HR", "2 HR", "1 HR", "0 HR", "2 HR", "1 HR", "0 HR"],
    "Method of Victory": ["Submission", "Decision", "KO", "Decision", "Submission", "KO", "Decision", "KO", "Decision", "Submission"],
  };

  const values = statTemplates[propType] ?? ["20", "18", "22", "24", "21", "19", "23", "20", "21", "18"];

  return Array.from({ length: 40 }, (_, index) => {
    const statResult = values[index % values.length];
    const homeAway = index % 2 === 0 ? "Home" : "Away";
    const parsedStat = Number.parseFloat(statResult.replace(/[^0-9.-]/g, ""));
    const playerStat = Number.isFinite(parsedStat) ? parsedStat : 1 + (index % 4);
    const plateAppearances = 4 + (index % 3);
    const hits = Math.max(0, Math.min(plateAppearances, Math.floor(playerStat / 2)));
    const extraBaseHits = playerStat >= 3 ? 1 : 0;
    const teamScore = 2 + (index % 6) + (playerStat > 2 ? 1 : 0);
    const opponentScore = 1 + (index % 5);

    return {
      date: `2025-${String(3 + (index % 6)).padStart(2, "0")}-${String(1 + (index % 28)).padStart(2, "0")}`,
      opponent: index % 3 === 0 ? opponent : "League foe",
      statResult,
      hit: evaluateOutcome(statResult, line, side),
      homeAway: homeAway as "Home" | "Away",
      playerStat,
      actualStatResult: `${playerStat} ${propType}`,
      teamScore,
      opponentScore,
      plateAppearances,
      hits,
      extraBaseHits,
    };
  });
};

const buildResearchFactors = (propType: string) => [
  {
    label: "Recent form",
    detail: `${propType} production has been trending above the line over the last two weeks.`,
    impact: "positive" as const,
  },
  {
    label: "Matchup",
    detail: "The opponent has shown a favorable pace and matchup profile for this market.",
    impact: "positive" as const,
  },
  {
    label: "Role / usage",
    detail: "The player is seeing elevated usage and a clear path to relevant volume.",
    impact: "positive" as const,
  },
  {
    label: "Injury impact",
    detail: "Minor injury noise is present, but the projected role remains intact.",
    impact: "neutral" as const,
  },
  {
    label: "Market line",
    detail: "The current line is slightly below the expected projection, creating potential value.",
    impact: "positive" as const,
  },
];

const createPropResearchItem = (item: Omit<PropResearchItem, "confidenceLabel" | "last5" | "last10" | "last20" | "last40" | "season" | "hitRates" | "gameLog" | "splits" | "matchup" | "researchFactors" | "aiAnalysis">) => {
  const confidenceLabel: ConfidenceLabel = item.confidence >= 80 ? "Strong" : item.confidence >= 65 ? "Good" : "Moderate";
  const gameLog = buildGameLog(item.propType, item.opponent, item.line, item.researchSide);
  const hitRates = {
    last5: calculateHitRate(gameLog, item.line, 5, item.researchSide),
    last10: calculateHitRate(gameLog, item.line, 10, item.researchSide),
    last20: calculateHitRate(gameLog, item.line, 20, item.researchSide),
    last40: calculateHitRate(gameLog, item.line, 40, item.researchSide),
    season: calculateHitRate(gameLog, item.line, gameLog.length, item.researchSide),
  };

  return {
    ...item,
    confidenceLabel,
    last5: `${hitRates.last5}%`,
    last10: `${hitRates.last10}%`,
    last20: `${hitRates.last20}%`,
    last40: `${hitRates.last40}%`,
    season: `${hitRates.season}%`,
    hitRates,
    gameLog,
    splits: {
      home: `${item.team} has covered this market at a 63% rate at home.`,
      away: `${item.team} has covered this market at a 57% rate on the road.`,
      similarOpponents: `Versus similar opponents, the trend is ${item.confidence >= 75 ? "strong" : "steady"}.`,
      recent5: `Recent 5-game sample shows ${hitRates.last5}% success rate.`,
      recent10: `Recent 10-game sample shows ${hitRates.last10}% success rate.`,
    },
    matchup: {
      opponentDefensiveRanking: `${Math.max(10, 30 - item.confidence)}th in the league`,
      opponentAllowedAverage: `${item.confidence >= 75 ? "24.0" : "21.5"} per game`,
      paceEnvironment: `${item.confidence >= 75 ? "Favorable" : "Neutral"} scoring environment`,
      difficulty: `${item.confidence >= 75 ? "Favorable" : "Balanced"}`,
      recentHistory: `${item.team} is ${item.confidence >= 75 ? "3-0" : "1-2"} in the last three matchups against this style.`,
    },
    researchFactors: buildResearchFactors(item.propType),
    aiAnalysis: {
      summary: `${item.player} has a compelling setup for this prop thanks to role usage, market value, and a favorable matchup.`,
      risks: `${item.player} could see a lower-usage game script if the matchup shifts or the game becomes lopsided.`,
      lean: `${item.confidence >= 80 ? "Strong lean to the over" : "Lean to the over with moderate conviction"}`,
    },
  } satisfies PropResearchItem;
};

function ensureUniquePropIds(items: PropResearchItem[]): PropResearchItem[] {
  const baseIdCounts = new Map<string, number>();
  const usedIds = new Set<string>();

  return items.map((item) => {
    const occurrence = (baseIdCounts.get(item.id) ?? 0) + 1;
    baseIdCounts.set(item.id, occurrence);

    if (occurrence === 1 && !usedIds.has(item.id)) {
      usedIds.add(item.id);
      return item;
    }

    const opportunityId = [
      item.id,
      item.researchSide.toLowerCase(),
      item.line.replace('.', '-'),
      item.team.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      item.opponent.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      item.gameTime.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      occurrence,
    ].join('-');

    if (usedIds.has(opportunityId)) {
      throw new Error(`Duplicate research opportunity id: ${opportunityId}`);
    }

    usedIds.add(opportunityId);
    return { ...item, id: opportunityId };
  });
}


export const propResearchData: PropResearchItem[] = ensureUniquePropIds([
  createPropResearchItem({
    id: "luka-doncic-points",
    sport: "NBA",
    player: "Luka Dončić",
    team: "Mavericks",
    opponent: "Nuggets",
    propType: "Points",
    line: "33.5",
    overOdds: "-110",
    underOdds: "-110",
    projectedValue: 6.4,
    confidence: 82,
    gameTime: "7:30 PM",
    researchSide: "Over",
  }),
  createPropResearchItem({
    id: "tyreek-hill-receiving-yards",
    sport: "NFL",
    player: "Tyreek Hill",
    team: "Dolphins",
    opponent: "Bills",
    propType: "Receiving Yards",
    line: "92.5",
    overOdds: "-115",
    underOdds: "-105",
    projectedValue: 5.1,
    confidence: 78,
    gameTime: "1:00 PM",
    researchSide: "Over",
  }),
  createPropResearchItem({
    id: "mookie-betts-hits",
    sport: "MLB",
    player: "Mookie Betts",
    playerId: 605141,
    team: "Dodgers",
    teamId: 119,
    opponent: "Padres",
    temperature: "68°",
    homeAway: "Away",
    propType: "Hits",
    line: "1.5",
    overOdds: "+105",
    underOdds: "-125",
    projectedValue: 4.8,
    confidence: 68,
    gameTime: "10:10 PM",
    researchSide: "Over",
    rationale: "High avg vs today's starting pitcher based on career splits.",
    projectedPlateAppearances: 4.7,
    projectedBattingOrder: 2,
    playerImageUrl: "https://images.unsplash.com/photo-1547347298-4074fc3086f0?auto=format&fit=crop&w=240&q=80",
    teamLogoUrl: "https://images.unsplash.com/photo-1517649763962-0c623066013b?auto=format&fit=crop&w=240&q=80",
    startingPitchers: {
      away: { name: "Nick Pivetta", hand: "RHP", era: "4.12", whip: "1.23", kRate: "23.9%", bbRate: "8.1%", hrPer9: "1.05", baa: ".247" },
      home: { name: "Dylan Cease", hand: "RHP", era: "3.89", whip: "1.16", kRate: "28.4%", bbRate: "7.6%", hrPer9: "0.97", baa: ".231" },
    },
    bullpen: {
      away: { era: "3.74", whip: "1.34", kRate: "24.2%", bbRate: "9.2%", hrPer9: "1.12", fip: "3.98", recentUsage: "7.2 IP / 3 days" },
      home: { era: "3.41", whip: "1.21", kRate: "26.8%", bbRate: "8.8%", hrPer9: "0.95", fip: "3.61", recentUsage: "6.4 IP / 3 days" },
    },
    lineup: {
      away: [
        { player: "Fernando Tatis Jr.", order: 1, avg: ".276", obp: ".346", slg: ".470", ops: ".816", hr: 12, rbi: 38, hand: "R" },
        { player: "Mookie Betts", order: 2, avg: ".283", obp: ".356", slg: ".466", ops: ".822", hr: 9, rbi: 35, hand: "R" },
        { player: "Freddie Freeman", order: 3, avg: ".296", obp: ".372", slg: ".531", ops: ".903", hr: 13, rbi: 49, hand: "L" },
      ],
      home: [
        { player: "Mookie Betts", order: 2, avg: ".283", obp: ".356", slg: ".466", ops: ".822", hr: 9, rbi: 35, hand: "R" },
        { player: "Shohei Ohtani", order: 3, avg: ".311", obp: ".404", slg: ".604", ops: ".1.008", hr: 24, rbi: 62, hand: "L" },
      ],
    },
    weather: {
      temperature: "72°F",
      conditions: "Clear",
      windSpeed: "8 mph",
      windDirection: "out to RF",
      humidity: "61%",
      rainChance: "10%",
    },
    stadium: {
      name: "Dodger Stadium",
      city: "Los Angeles, CA",
      parkFactor: "108",
    },
    teamRecord: {
      away: { name: "Padres", overall: "34-29", home: "20-11", away: "14-18", last10: "6-4" },
      home: { name: "Dodgers", overall: "41-22", home: "21-10", away: "20-12", last10: "8-2" },
    },
    matchupStats: {
      awayVsRHP: { avg: ".268", obp: ".337", slg: ".456", ops: ".793", kRate: "22.1%", bbRate: "7.9%", hrRate: "3.4%" },
      homeVsLHP: { avg: ".251", obp: ".322", slg: ".431", ops: ".753", kRate: "24.7%", bbRate: "6.8%", hrRate: "2.6%" },
    },
  }),
  createPropResearchItem({
    id: "connor-mcdavid-points",
    sport: "NHL",
    player: "Connor McDavid",
    team: "Oilers",
    opponent: "Canucks",
    propType: "Points",
    line: "1.5",
    overOdds: "-130",
    underOdds: "+110",
    projectedValue: 4.4,
    confidence: 76,
    gameTime: "9:00 PM",
    researchSide: "Over",
  }),
  createPropResearchItem({
    id: "vinicius-junior-shots",
    sport: "Soccer",
    player: "Vinícius Júnior",
    team: "Real Madrid",
    opponent: "Barcelona",
    propType: "Shots",
    line: "4.5",
    overOdds: "-105",
    underOdds: "-115",
    projectedValue: 3.9,
    confidence: 70,
    gameTime: "3:00 PM",
    researchSide: "Over",
  }),
  createPropResearchItem({
    id: "jon-jones-method-of-victory",
    sport: "UFC",
    player: "Jon Jones",
    team: "UFC",
    opponent: "Stipe Miocic",
    propType: "Method of Victory",
    line: "-250",
    overOdds: "-140",
    underOdds: "+120",
    projectedValue: 3.2,
    confidence: 68,
    gameTime: "10:00 PM",
    researchSide: "Over",
  }),
  createPropResearchItem({
    id: "jalen-brunson-assists",
    sport: "NBA",
    player: "Jalen Brunson",
    team: "Knicks",
    opponent: "Celtics",
    propType: "Assists",
    line: "7.5",
    overOdds: "-115",
    underOdds: "-105",
    projectedValue: 5.7,
    confidence: 80,
    gameTime: "8:00 PM",
    researchSide: "Over",
  }),
  createPropResearchItem({
    id: "justin-jefferson-receiving-yards",
    sport: "NFL",
    player: "Justin Jefferson",
    team: "Vikings",
    opponent: "Packers",
    propType: "Receiving Yards",
    line: "96.5",
    overOdds: "-110",
    underOdds: "-110",
    projectedValue: 4.1,
    confidence: 71,
    gameTime: "4:25 PM",
    researchSide: "Over",
  }),
  createPropResearchItem({
    id: "shohei-ohtani-total-bases",
    sport: "MLB",
    player: "Shohei Ohtani",
    playerId: 660271,
    team: "Dodgers",
    teamId: 119,
    opponent: "Giants",
    temperature: "68°",
    homeAway: "Away",
    propType: "Total Bases",
    line: "1.5",
    overOdds: "-110",
    underOdds: "-110",
    projectedValue: 7.9,
    confidence: 81,
    gameTime: "8:45 PM",
    researchSide: "Over",
    rationale: "Elite barrel rate + favorable park factor at Oracle Park.",
  }),
  createPropResearchItem({
    id: "juan-soto-total-bases",
    sport: "MLB",
    player: "Juan Soto",
    playerId: 665742,
    team: "Yankees",
    teamId: 147,
    opponent: "Red Sox",
    temperature: "72°",
    homeAway: "Away",
    propType: "Total Bases",
    line: "1.5",
    overOdds: "-115",
    underOdds: "-105",
    projectedValue: 6.8,
    confidence: 79,
    gameTime: "7:10 PM",
    researchSide: "Over",
    rationale: "Consistent contact vs LHP — starter throws left-handed.",
  }),
  createPropResearchItem({
    id: "kyle-schwarber-home-runs",
    sport: "MLB",
    player: "Kyle Schwarber",
    playerId: 656941,
    team: "Phillies",
    teamId: 143,
    opponent: "Marlins",
    temperature: "69°",
    homeAway: "Home",
    propType: "HomeRuns",
    line: "0.5",
    overOdds: "+100",
    underOdds: "-120",
    projectedValue: 6.2,
    confidence: 72,
    gameTime: "5:40 PM",
    researchSide: "Over",
    rationale: "Leads MLB in barrel % and faces a high-ERA Marlins starter.",
  }),
  createPropResearchItem({
    id: "aaron-judge-home-runs",
    sport: "MLB",
    player: "Aaron Judge",
    playerId: 592450,
    team: "Yankees",
    teamId: 147,
    opponent: "Red Sox",
    temperature: "72°",
    homeAway: "Away",
    propType: "HomeRuns",
    line: "0.5",
    overOdds: "-120",
    underOdds: "+100",
    projectedValue: 8.4,
    confidence: 86,
    gameTime: "7:10 PM",
    researchSide: "Over",
    rationale: "Strong recent power trend + facing a high-ERA RHP at Fenway.",
  }),
  createPropResearchItem({
    id: "erling-haaland-goals",
    sport: "Soccer",
    player: "Erling Haaland",
    team: "Manchester City",
    opponent: "Arsenal",
    propType: "Goals",
    line: "0.5",
    overOdds: "-160",
    underOdds: "+130",
    projectedValue: 3.6,
    confidence: 69,
    gameTime: "11:30 AM",
    researchSide: "Over",
  }),
]);

export const getPropById = (id: string) => propResearchData.find((prop) => prop.id === id);
