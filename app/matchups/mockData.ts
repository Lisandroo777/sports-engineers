export interface MatchupGame {
  id: string;
  awayTeam: string;
  homeTeam: string;
  awayTeamId?: number;
  homeTeamId?: number;
  awayRecord: string;
  homeRecord: string;
  awayDivision?: string;
  homeDivision?: string;
  time: string;
  stadium: string;
  weather: string;
  moneyline: string;
  runLine: string;
  total: string;
  awayLogo: string;
  homeLogo: string;
}

export interface Pitcher {
  id: string;
  name: string;
  hand: string;
  record: string;
  era: string;
  whip: string;
  fip: string;
  xfip: string;
  kPercent: string;
  bbPercent: string;
  kbb: string;
  hrPer9: string;
  baa: string;
  hardHit: string;
  gb: string;
  recent5Era: string;
  photo: string;
  totalK?: string;
  projectedIP?: string;
  projectedPitches?: string;
  projectedBF?: string;
  projectedK?: string;
  vsOpponent2025?: string;
  mlbPlayerId?: number;
  siera?: string;
  vsLhbWoba?: string; vsLhbOps?: string; vsLhbKPercent?: string; vsLhbBbPercent?: string;
  vsRhbWoba?: string; vsRhbOps?: string; vsRhbKPercent?: string; vsRhbBbPercent?: string;
  recentFormRecord?: string;
  recentFormIp?: string; recentFormEra?: string; recentFormK9?: string; recentFormBb9?: string; recentFormWhip?: string;
  recentFormGames?: string[];
}

export interface Batter {
  id: string;
  name: string;
  order: number;
  position: string;
  hand: string;
  avg: string;
  obp: string;
  slg: string;
  ops: string;
  hr: number;
  rbi: number;
  last10Ops: string;
  strong: boolean;
  paPro?: string;
  wOps?: string;
  vsHandedWoba?: string;
}

export interface TeamSplit {
  team: string;
  vs: string;
  avg: string;
  obp: string;
  slg: string;
  ops: string;
  woba: string;
  wrcPlus: string;
  kPercent: string;
  bbPercent: string;
  iso: string;
  hrRate: string;
}

export interface BullpenStats {
  era: string;
  fip: string;
  whip: string;
  kPercent: string;
  bbPercent: string;
  hrPer9: string;
  savePercent: string;
  last3Days: string;
  last7Days: string;
  fatigue: 'Fresh' | 'Moderate' | 'Heavy';
}

export interface TeamForm {
  last5: string;
  last10: string;
  streak: string;
  runsPerGame: string;
  runsAllowed: string;
  homeRecord: string;
  awayRecord: string;
}

export interface HeadToHeadGame {
  date: string;
  score: string;
  winner: string;
  stadium: string;
  awayPitcherNote?: string;
  homePitcherNote?: string;
}

export interface WeatherInfo {
  stadium: string;
  city: string;
  temperature: string;
  condition: string;
  windSpeed: string;
  windDirection: string;
  humidity: string;
  rainChance: string;
  parkFactor: string;
  hrFactor: string;
  runFactor: string;
  fbFactor?: string;
  kFactor?: string;
  parkDescription?: string;
}

export interface MatchupEdge {
  label: string;
  away: string;
  home: string;
}

export interface Insight {
  text: string;
}

export interface RelevantProp {
  id: string;
  player: string;
  prop: string;
  line: string;
  l10HitRate: string;
  confidence: number;
}

export interface MatchupData {
  id: string;
  game: MatchupGame;
  projection?: MatchupProjection;
  awayPitcher: Pitcher;
  homePitcher: Pitcher;
  awayLineup: Batter[];
  homeLineup: Batter[];
  awaySplit: TeamSplit;
  homeSplit: TeamSplit;
  awayBullpen: BullpenStats;
  homeBullpen: BullpenStats;
  awayForm: TeamForm;
  homeForm: TeamForm;
  awayRecentGames?: string[];
  homeRecentGames?: string[];
  headToHead: HeadToHeadGame[];
  weather: WeatherInfo;
  edges: MatchupEdge[];
  insights: Insight[];
  relevantProps: RelevantProp[];
  playersToWatch?: Array<{ player: string; playerId?: number; team: string; teamId?: number; note: string; score: number; positives: string[]; risk: string }>;
  propAngles?: Array<{ player: string; prop: string; score: number; positives: string[]; risks: string[] }>;
  bvpAway?: Array<{ player: string; hand: string; pa: number; h: number; hr: number; avg: string; ops: string; k: string; bb: string; notes: string }>;
  bvpHome?: Array<{ player: string; hand: string; pa: number; h: number; hr: number; avg: string; ops: string; k: string; bb: string; notes: string }>;
  matchupProps?: Array<{ id: string; player: string; playerId?: number; team: string; teamId?: number; prop: string; line: string; side: 'Over' | 'Under'; odds: string; l5: number; l10: number; l20: number; l40: number; season2026: number; confidence: number; matchupScore: number; rationale?: string }>;
  realProps?: import('../../lib/odds/types').NormalizedProp[];
  playerTrends?: Array<{ player: string; playerId?: number; team: string; teamId?: number; position: string; l5Avg: string; l5Hr: number; l5Ops: string; l10Avg: string; l10Hr: number; l10Ops: string; trend: 'up' | 'down' | 'neutral' }>;
  matchupInsights?: Array<{ category: string; teamAdvantage: string; explanation: string; detail: string; icon: string; beginner?: string }>;
  gameAlerts?: Array<{
    id: string;
    category: 'LINEUP' | 'PLAYER' | 'PITCHER' | 'WEATHER' | 'ODDS' | 'INJURY';
    severity: 'CRITICAL' | 'IMPORTANT' | 'INFO';
    title: string;
    detail: string;
    time: string;
    impactLevel?: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
    impactAreas?: string[];
    whyItMatters?: string;
    beforeValue?: string;
    afterValue?: string;
    affectedTeam?: string;
    affectedTeamId?: number;
    affectedPlayer?: string;
    affectedPlayerId?: number;
    timeline?: Array<{ time: string; note: string }>;
    relatedProps?: Array<{ player: string; playerId?: number; prop: string; line: string; side: string; confidence: number; matchupScore: number }>;
    affectedPlayers?: Array<{ name: string; playerId?: number; teamId?: number; team: string; position?: string }>;
    dataStatus?: 'REAL_MLB' | 'PROJECTED' | 'MOCK';
  }>;
  gameOdds?: { awayMoneyline: string; homeMoneyline: string; awayRunLine: string; awayRunLineOdds: string; homeRunLine: string; homeRunLineOdds: string; total: string; overOdds: string; underOdds: string; impliedProbAway: number; impliedProbHome: number };
}

export interface MatchupProjection {
  awayWinProbability: number;
  homeWinProbability: number;
  modelConfidence: number;
  modelConfidenceLabel: string;
  projectedAwayScore: string;
  projectedHomeScore: string;
  projectedTotal: string;
  leanTeam: string;
  whyLean: Array<{ label: string; detail: string; positive: boolean }>;
  riskFactors: Array<{ text: string; severity: 'HIGH' | 'MEDIUM' | 'LOW' }>;
  quickInfo: { firstPitch: string; stadium: string; surface: string; capacity: string; umpire: string; tv: string };
}

export const matchupData: MatchupData[] = [
  {
    id: 'red-sox-yankees',
    game: {
      id: 'red-sox-yankees',
      awayTeam: 'Red Sox',
      homeTeam: 'Yankees',
      awayTeamId: 111,
      homeTeamId: 147,
      awayRecord: '28-30',
      homeRecord: '37-22',
      awayDivision: '2nd AL East',
      homeDivision: '1st AL East',
      time: '7:05 PM',
      stadium: 'Yankee Stadium',
      weather: 'Clear • 72°F',
      moneyline: 'BOS +145 • NYY -170',
      runLine: 'BOS +1.5 • NYY -1.5',
      total: '8.5',
      awayLogo: 'BOS',
      homeLogo: 'NYY',
    },
    awayPitcher: {
      id: 'crochet',
      name: 'Garrett Crochet',
      hand: 'LHP',
      record: '11-4',
      era: '3.24',
      whip: '1.18',
      fip: '3.21',
      xfip: '3.44',
      kPercent: '30.2%',
      bbPercent: '7.3%',
      kbb: '4.1',
      hrPer9: '1.02',
      baa: '.241',
      hardHit: '38.1%',
      gb: '46.7%',
      recent5Era: '3.12',
      photo: 'GC',
      totalK: '134',
      projectedIP: '5.8',
      projectedPitches: '94',
      projectedBF: '23',
      projectedK: '6.7',
      vsOpponent2025: '2-0 • 1.80 ERA • 18 K',
      siera: '3.38',
      vsLhbWoba: '.289', vsLhbOps: '.772', vsLhbKPercent: '30.2%', vsLhbBbPercent: '7.1%',
      vsRhbWoba: '.254', vsRhbOps: '.698', vsRhbKPercent: '29.8%', vsRhbBbPercent: '7.6%',
      recentFormRecord: '7-2', recentFormIp: '59.2', recentFormEra: '3.01', recentFormK9: '11.3', recentFormBb9: '2.1', recentFormWhip: '1.05',
      recentFormGames: ['W', 'W', 'L', 'W', 'W', 'W', 'W', 'L', 'W', 'W'],
    },
    homePitcher: {
      id: 'rodon',
      name: 'Carlos Rodón',
      hand: 'LHP',
      record: '9-6',
      era: '3.92',
      whip: '1.14',
      fip: '3.65',
      xfip: '3.79',
      kPercent: '29.4%',
      bbPercent: '6.8%',
      kbb: '3.4',
      hrPer9: '1.11',
      baa: '.238',
      hardHit: '36.7%',
      gb: '48.2%',
      recent5Era: '2.87',
      photo: 'CR',
      totalK: '128',
      projectedIP: '5.6',
      projectedPitches: '92',
      projectedBF: '22',
      projectedK: '6.0',
      vsOpponent2025: '1-1 • 4.50 ERA • 17 K',
      siera: '4.21',
      vsLhbWoba: '.318', vsLhbOps: '.866', vsLhbKPercent: '22.1%', vsLhbBbPercent: '8.9%',
      vsRhbWoba: '.279', vsRhbOps: '.748', vsRhbKPercent: '25.8%', vsRhbBbPercent: '6.7%',
      recentFormRecord: '5-5', recentFormIp: '57.0', recentFormEra: '3.78', recentFormK9: '10.0', recentFormBb9: '2.9', recentFormWhip: '1.19',
      recentFormGames: ['W', 'L', 'W', 'L', 'W', 'L', 'W', 'W', 'L', 'W'],
    },
    awayLineup: [
      { id: 'b1', name: 'Jarren Duran', order: 1, position: 'LF', hand: 'L', avg: '.289', obp: '.344', slg: '.451', ops: '.795', hr: 8, rbi: 31, last10Ops: '.912', strong: true, paPro: '4.6', wOps: '.360', vsHandedWoba: '.378' },
      { id: 'b2', name: 'Rafael Devers', order: 2, position: '3B', hand: 'L', avg: '.274', obp: '.347', slg: '.501', ops: '.848', hr: 18, rbi: 44, last10Ops: '.914', strong: true, paPro: '4.4', wOps: '.355', vsHandedWoba: '.341' },
      { id: 'b3', name: 'Alex Bregman', order: 3, position: '3B', hand: 'R', avg: '.277', obp: '.355', slg: '.466', ops: '.821', hr: 10, rbi: 36, last10Ops: '.873', strong: true, paPro: '4.3', wOps: '.355', vsHandedWoba: '.341' },
      { id: 'b4', name: 'Triston Casas', order: 4, position: '1B', hand: 'L', avg: '.242', obp: '.328', slg: '.431', ops: '.759', hr: 12, rbi: 38, last10Ops: '.802', strong: false, paPro: '4.2', wOps: '.328', vsHandedWoba: '.316' },
      { id: 'b5', name: 'Masataka Yoshida', order: 5, position: 'DH', hand: 'L', avg: '.297', obp: '.352', slg: '.462', ops: '.814', hr: 10, rbi: 36, last10Ops: '.873', strong: true, paPro: '4.1', wOps: '.338', vsHandedWoba: '.392' },
      { id: 'b6', name: 'Trevor Story', order: 6, position: 'SS', hand: 'R', avg: '.239', obp: '.310', slg: '.421', ops: '.731', hr: 9, rbi: 28, last10Ops: '.756', strong: false, paPro: '3.9', wOps: '.310', vsHandedWoba: '.305' },
      { id: 'b7', name: 'Ceddanne Rafaela', order: 7, position: 'CF', hand: 'R', avg: '.246', obp: '.311', slg: '.407', ops: '.718', hr: 7, rbi: 24, last10Ops: '.741', strong: false, paPro: '3.7', wOps: '.311', vsHandedWoba: '.290' },
      { id: 'b8', name: 'Connor Wong', order: 8, position: 'C', hand: 'R', avg: '.228', obp: '.295', slg: '.401', ops: '.696', hr: 6, rbi: 20, last10Ops: '.724', strong: false, paPro: '3.6', wOps: '.295', vsHandedWoba: '.268' },
      { id: 'b9', name: 'Emanuel Valdez', order: 9, position: '2B', hand: 'R', avg: '.212', obp: '.276', slg: '.334', ops: '.610', hr: 4, rbi: 14, last10Ops: '.612', strong: false, paPro: '3.2', wOps: '.276', vsHandedWoba: '.244' },
    ],
    homeLineup: [
      { id: 'h1', name: 'Aaron Judge', order: 1, position: 'RF', hand: 'R', avg: '.321', obp: '.430', slg: '.680', ops: '1.110', hr: 28, rbi: 60, last10Ops: '1.083', strong: true, paPro: '4.5', wOps: '.448', vsHandedWoba: '.448' },
      { id: 'h2', name: 'Juan Soto', order: 2, position: 'LF', hand: 'L', avg: '.287', obp: '.410', slg: '.538', ops: '.948', hr: 15, rbi: 41, last10Ops: '.956', strong: true, paPro: '4.3', wOps: '.421', vsHandedWoba: '.432' },
      { id: 'h3', name: 'Gleyber Torres', order: 3, position: '2B', hand: 'R', avg: '.258', obp: '.332', slg: '.446', ops: '.778', hr: 11, rbi: 37, last10Ops: '.816', strong: false, paPro: '4.1', wOps: '.322', vsHandedWoba: '.330' },
      { id: 'h4', name: 'Giancarlo Stanton', order: 4, position: 'DH', hand: 'R', avg: '.220', obp: '.300', slg: '.440', ops: '.740', hr: 14, rbi: 35, last10Ops: '.778', strong: false, paPro: '3.9', wOps: '.300', vsHandedWoba: '.296' },
      { id: 'h5', name: 'Jazz Chisholm Jr.', order: 5, position: 'CF', hand: 'L', avg: '.236', obp: '.320', slg: '.442', ops: '.762', hr: 12, rbi: 31, last10Ops: '.801', strong: false, paPro: '3.8', wOps: '.320', vsHandedWoba: '.342' },
      { id: 'h6', name: 'Ben Rice', order: 6, position: '1B', hand: 'L', avg: '.245', obp: '.315', slg: '.421', ops: '.736', hr: 10, rbi: 28, last10Ops: '.758', strong: false, paPro: '3.6', wOps: '.315', vsHandedWoba: '.305' },
      { id: 'h7', name: 'Oswaldo Cabrera', order: 7, position: 'SS', hand: 'S', avg: '.214', obp: '.279', slg: '.381', ops: '.660', hr: 6, rbi: 21, last10Ops: '.682', strong: false, paPro: '3.4', wOps: '.279', vsHandedWoba: '.266' },
      { id: 'h8', name: 'Jose Trevino', order: 8, position: 'C', hand: 'R', avg: '.203', obp: '.271', slg: '.341', ops: '.612', hr: 4, rbi: 16, last10Ops: '.631', strong: false, paPro: '3.2', wOps: '.271', vsHandedWoba: '.247' },
      { id: 'h9', name: 'Anthony Volpe', order: 9, position: 'SS', hand: 'R', avg: '.225', obp: '.287', slg: '.362', ops: '.649', hr: 5, rbi: 19, last10Ops: '.668', strong: false, paPro: '3.1', wOps: '.287', vsHandedWoba: '.280' },
    ],
    awaySplit: { team: 'Red Sox', vs: 'LHP', avg: '.268', obp: '.337', slg: '.456', ops: '.793', woba: '.335', wrcPlus: '116', kPercent: '22.1%', bbPercent: '7.9%', iso: '.188', hrRate: '3.4%' },
    homeSplit: { team: 'Yankees', vs: 'RHP', avg: '.251', obp: '.322', slg: '.431', ops: '.753', woba: '.319', wrcPlus: '107', kPercent: '24.7%', bbPercent: '6.8%', iso: '.180', hrRate: '2.6%' },
    awayBullpen: { era: '3.68', fip: '3.94', whip: '1.24', kPercent: '24.0%', bbPercent: '9.0%', hrPer9: '1.15', savePercent: '72%', last3Days: '7.1 IP', last7Days: '14.2 IP', fatigue: 'Moderate' },
    homeBullpen: { era: '3.41', fip: '3.56', whip: '1.16', kPercent: '26.3%', bbPercent: '8.7%', hrPer9: '0.96', savePercent: '81%', last3Days: '6.8 IP', last7Days: '13.4 IP', fatigue: 'Fresh' },
    awayForm: { last5: '3-2', last10: '6-4', streak: 'W2', runsPerGame: '4.8', runsAllowed: '4.2', homeRecord: '12-16', awayRecord: '16-14' },
    homeForm: { last5: '4-1', last10: '7-3', streak: 'W3', runsPerGame: '5.2', runsAllowed: '4.0', homeRecord: '22-9', awayRecord: '15-13' },
    awayRecentGames: ['W', 'W', 'L', 'W', 'L', 'W', 'W', 'L', 'W', 'W'],
    homeRecentGames: ['W', 'W', 'W', 'L', 'W', 'W', 'L', 'W', 'W', 'L'],
    projection: {
      awayWinProbability: 59,
      homeWinProbability: 41,
      modelConfidence: 7.4,
      modelConfidenceLabel: 'Moderate',
      projectedAwayScore: '5.1',
      projectedHomeScore: '4.3',
      projectedTotal: '9.4',
      leanTeam: 'Red Sox',
      whyLean: [
        { label: 'Starting Pitching', detail: 'BOS: Garrett Crochet (3.24 ERA) vs Rodon (3.92 ERA)', positive: true },
        { label: 'Bullpen', detail: 'BOS: 3.21 ERA vs NYY: 3.89 ERA', positive: true },
        { label: 'Offense vs LHP', detail: 'BOS: .335 wOBA vs LHP (5th in MLB)', positive: true },
        { label: 'Recent Form', detail: 'BOS: 6-4 in last 10 games', positive: true },
        { label: 'Home Field', detail: 'NYY 37-22 at home', positive: false },
      ],
      riskFactors: [
        { text: 'Starting pitcher scratched', severity: 'HIGH' },
        { text: 'Key player removed from lineup', severity: 'MEDIUM' },
        { text: 'Significant odds movement', severity: 'MEDIUM' },
        { text: 'Bullpen heavily overused', severity: 'MEDIUM' },
        { text: 'Weather/wind shifts significantly', severity: 'LOW' },
      ],
      quickInfo: {
        firstPitch: '7:05 PM ET',
        stadium: 'Yankee Stadium',
        surface: 'Grass',
        capacity: '47,309',
        umpire: 'Gerry Davis (HP)',
        tv: 'NESN, YES, MLBN',
      },
    },
    playersToWatch: [
      { player: 'Aaron Judge', playerId: 592450, team: 'Yankees', teamId: 147, note: 'Power matchup vs LHP', score: 8.7, positives: ['Strong power vs LHP', '4.5 projected PA', 'HR-friendly park'], risk: 'Wind only mildly favorable' },
      { player: 'Rafael Devers', playerId: 646240, team: 'Red Sox', teamId: 111, note: 'Strong platoon advantage', score: 8.4, positives: ['.335 wOBA vs LHP (5th MLB)', 'Hot stretch last 10 games', 'Favorable batting order slot'], risk: 'Moderate strikeout risk vs Rodon' },
      { player: 'Garrett Crochet', playerId: 667579, team: 'Red Sox', teamId: 111, note: 'Strikeout opportunity', score: 7.9, positives: ['30.2% K rate on season', '6.7 projected strikeouts', 'Yankees have 24.7% K rate vs LHP'], risk: 'Recent 5-game ERA uptick' },
      { player: 'Juan Soto', playerId: 665742, team: 'Yankees', teamId: 147, note: 'High on-base threat', score: 7.6, positives: ['Elite BB% against any pitcher', '.421 OBP in last 10 games', 'Favorable park factor'], risk: 'Low HR output recently' },
    ],
    propAngles: [
      { player: 'Aaron Judge', prop: 'Home Runs', score: 8.7, positives: ['Strong power vs LHP', '4.5 projected PA', 'HR-friendly park (112 factor)'], risks: ['Wind only mildly favorable out to RF'] },
      { player: 'Rafael Devers', prop: 'Total Bases', score: 8.4, positives: ['.335 wOBA vs LHP', 'Hot power streak last 10 games', 'Favorable park factor'], risks: ['Rodon slider tough on LHB'] },
      { player: 'Garrett Crochet', prop: 'Strikeouts', score: 7.9, positives: ['30.2% K rate', 'Yankees 24.7% K vs LHP', '6.7 projected K'], risks: ['NYY contact rate has improved recently'] },
      { player: 'Juan Soto', prop: 'Hits', score: 7.6, positives: ['.421 OBP', '.287 AVG vs RHP', 'High projected PA'], risks: ['Low HR environment for Soto today'] },
    ],
    bvpAway: [
      { player: 'Rafael Devers', hand: 'L', pa: 18, h: 6, hr: 2, avg: '.333', ops: '1.018', k: '16.7%', bb: '11.1%', notes: 'Solid history' },
      { player: 'Trevor Story', hand: 'R', pa: 14, h: 4, hr: 1, avg: '.286', ops: '.812', k: '21.4%', bb: '7.1%', notes: 'Small sample' },
      { player: 'Masataka Yoshida', hand: 'L', pa: 9, h: 2, hr: 0, avg: '.222', ops: '.589', k: '22.2%', bb: '11.1%', notes: 'Small sample' },
      { player: 'Jarren Duran', hand: 'L', pa: 7, h: 2, hr: 0, avg: '.286', ops: '.678', k: '14.3%', bb: '0%', notes: 'Small sample' },
    ],
    bvpHome: [
      { player: 'Aaron Judge', hand: 'R', pa: 6, h: 1, hr: 1, avg: '.167', ops: '.667', k: '33.3%', bb: '16.7%', notes: 'Small sample' },
      { player: 'Juan Soto', hand: 'L', pa: 8, h: 2, hr: 0, avg: '.250', ops: '.625', k: '25.0%', bb: '12.5%', notes: 'Small sample' },
      { player: 'Gleyber Torres', hand: 'R', pa: 5, h: 1, hr: 0, avg: '.200', ops: '.400', k: '20.0%', bb: '0%', notes: 'Small sample' },
      { player: 'Giancarlo Stanton', hand: 'R', pa: 4, h: 1, hr: 1, avg: '.250', ops: '1.250', k: '50.0%', bb: '0%', notes: 'Small sample' },
    ],
    matchupProps: [
      { id: 'p1', player: 'Aaron Judge', playerId: 592450, team: 'NYY', teamId: 147, prop: 'Home Runs', line: '0.5', side: 'Over', odds: '+120', l5: 80, l10: 70, l20: 75, l40: 68, season2026: 72, confidence: 86, matchupScore: 8.7, rationale: 'Strong power vs LHP + HR-friendly park' },
      { id: 'p2', player: 'Rafael Devers', playerId: 646240, team: 'BOS', teamId: 111, prop: 'Total Bases', line: '1.5', side: 'Over', odds: '-115', l5: 74, l10: 72, l20: 71, l40: 69, season2026: 70, confidence: 82, matchupScore: 8.4, rationale: '.335 wOBA vs LHP + elevated home run rate' },
      { id: 'p3', player: 'Garrett Crochet', playerId: 667579, team: 'BOS', teamId: 111, prop: 'Strikeouts', line: '6.5', side: 'Over', odds: '-105', l5: 80, l10: 70, l20: 72, l40: 68, season2026: 71, confidence: 79, matchupScore: 7.9, rationale: '30.2% K rate + Yankees 24.7% K rate vs LHP' },
      { id: 'p4', player: 'Juan Soto', playerId: 665742, team: 'NYY', teamId: 147, prop: 'Hits', line: '1.5', side: 'Over', odds: '+105', l5: 72, l10: 69, l20: 68, l40: 66, season2026: 67, confidence: 76, matchupScore: 7.6, rationale: '.421 OBP + high projected PA in leadoff-adjacent slot' },
      { id: 'p5', player: 'Carlos Rodon', playerId: 640451, team: 'NYY', teamId: 147, prop: 'Strikeouts', line: '5.5', side: 'Over', odds: '+110', l5: 60, l10: 62, l20: 64, l40: 63, season2026: 62, confidence: 71, matchupScore: 7.2, rationale: '29.4% K rate + Red Sox 22.1% K rate vs LHP' },
      { id: 'p6', player: 'Jarren Duran', playerId: 680776, team: 'BOS', teamId: 111, prop: 'Stolen Bases', line: '0.5', side: 'Over', odds: '+140', l5: 60, l10: 58, l20: 57, l40: 55, season2026: 56, confidence: 68, matchupScore: 6.8, rationale: 'Active base stealer + favorable matchup situation' },
    ],
    playerTrends: [
      { player: 'Aaron Judge', playerId: 592450, team: 'Yankees', teamId: 147, position: 'RF', l5Avg: '.364', l5Hr: 3, l5Ops: '1.121', l10Avg: '.341', l10Hr: 5, l10Ops: '1.089', trend: 'up' },
      { player: 'Rafael Devers', playerId: 646240, team: 'Red Sox', teamId: 111, position: '3B', l5Avg: '.322', l5Hr: 2, l5Ops: '.987', l10Avg: '.298', l10Hr: 3, l10Ops: '.904', trend: 'up' },
      { player: 'Juan Soto', playerId: 665742, team: 'Yankees', teamId: 147, position: 'LF', l5Avg: '.286', l5Hr: 1, l5Ops: '.893', l10Avg: '.272', l10Hr: 2, l10Ops: '.856', trend: 'neutral' },
      { player: 'Jarren Duran', playerId: 680776, team: 'Red Sox', teamId: 111, position: 'LF', l5Avg: '.311', l5Hr: 0, l5Ops: '.842', l10Avg: '.289', l10Hr: 1, l10Ops: '.795', trend: 'up' },
      { player: 'Masataka Yoshida', playerId: 673548, team: 'Red Sox', teamId: 111, position: 'DH', l5Avg: '.333', l5Hr: 1, l5Ops: '.912', l10Avg: '.297', l10Hr: 2, l10Ops: '.877', trend: 'up' },
    ],
    matchupInsights: [
      { category: 'Starting Pitching', teamAdvantage: 'Red Sox', explanation: 'Boston holds the edge with Crochet vs Rodon based on ERA, FIP, and K rate.', detail: 'Crochet 3.24 ERA vs Rodon 3.92 ERA', icon: 'pitcher', beginner: 'A lower ERA means the pitcher allows fewer runs on average.' },
      { category: 'Power', teamAdvantage: 'Yankees', explanation: 'New York leads in HR rate and extra-base hit production this season.', detail: 'NYY 2.3 HR/game vs BOS 1.9 HR/game', icon: 'power', beginner: 'Teams that hit more home runs create more scoring opportunities.' },
      { category: 'Bullpen', teamAdvantage: 'Red Sox', explanation: 'Boston bullpen posts a slightly better ERA with less recent usage.', detail: 'BOS 3.68 ERA vs NYY 3.89 ERA', icon: 'bullpen', beginner: 'Bullpen quality matters late in close games.' },
      { category: 'Weather', teamAdvantage: 'Neutral', explanation: '8 mph wind blowing out to RF provides a mild boost to RHB power production.', detail: '72F Clear, 8mph Out to RF, Humidity 61%', icon: 'weather', beginner: 'Wind blowing toward the outfield can slightly increase home run potential.' },
      { category: 'Recent Form', teamAdvantage: 'Yankees', explanation: 'New York has gone 7-3 in their last 10 games versus 6-4 for Boston.', detail: 'NYY L10: 7-3, BOS L10: 6-4', icon: 'form', beginner: 'Teams in good recent form tend to perform better in upcoming games.' },
      { category: 'Plate Discipline', teamAdvantage: 'Red Sox', explanation: 'Boston posts a higher BB% vs LHP, giving them an edge against Rodon.', detail: 'BOS BB% vs LHP: 7.9% vs NYY: 6.8%', icon: 'discipline', beginner: 'Better plate discipline means more walks and fewer strikeouts.' },
      { category: 'Home Field', teamAdvantage: 'Yankees', explanation: 'New York holds a 22-9 record at Yankee Stadium this season.', detail: 'NYY home record: 22-9', icon: 'home', beginner: 'Home teams generally perform better due to familiarity with the ballpark.' },
    ],
    gameAlerts: [
      {
        id: 'a1', category: 'LINEUP', severity: 'INFO',
        title: 'Red Sox lineup confirmed', detail: 'Duran leads off, Devers batting 2nd. Full 9-man lineup officially set.',
        time: '2m ago', impactLevel: 'LOW', dataStatus: 'REAL_MLB',
        beforeValue: 'Projected', afterValue: 'Confirmed',
        affectedTeam: 'Red Sox', affectedTeamId: 111,
        impactAreas: ['Lineup', 'Projected PA', 'Player Props', 'Batting Order'],
        whyItMatters: 'A confirmed lineup removes uncertainty around batting order and expected plate appearances, making projected PA values and player-prop research significantly more reliable.',
        timeline: [
          { time: '5:15 PM', note: 'Lineup card filed with MLB' },
          { time: '5:18 PM', note: 'Lineup confirmed via MLB Stats API' },
          { time: '5:20 PM', note: 'Alert triggered on DeepSide' },
        ],
        affectedPlayers: [
          { name: 'Jarren Duran', playerId: 680776, teamId: 111, team: 'BOS', position: 'LF' },
          { name: 'Rafael Devers', playerId: 646240, teamId: 111, team: 'BOS', position: '3B' },
          { name: 'Masataka Yoshida', playerId: 673548, teamId: 111, team: 'BOS', position: 'DH' },
        ],
        relatedProps: [
          { player: 'Jarren Duran', playerId: 680776, prop: 'Stolen Bases', line: '0.5', side: 'Over', confidence: 68, matchupScore: 6.8 },
          { player: 'Rafael Devers', playerId: 646240, prop: 'Total Bases', line: '1.5', side: 'Over', confidence: 82, matchupScore: 8.4 },
        ],
      },
      {
        id: 'a2', category: 'PITCHER', severity: 'INFO',
        title: 'Crochet starting as expected', detail: 'No injury concerns. Pitching on full 5-day rest with a clean bullpen session Wednesday.',
        time: '5m ago', impactLevel: 'LOW', dataStatus: 'REAL_MLB',
        beforeValue: 'Scheduled', afterValue: 'Confirmed Start',
        affectedTeam: 'Red Sox', affectedTeamId: 111,
        affectedPlayer: 'Garrett Crochet', affectedPlayerId: 667579,
        impactAreas: ['Pitcher Matchup', 'Strikeouts', 'Batter vs Pitcher', 'Moneyline'],
        whyItMatters: 'Confirmed starting pitchers allow accurate projections for strikeout props, batter vs pitcher splits, projected IP, and lineup-based odds calculations.',
        timeline: [
          { time: '4:30 PM', note: 'Media report: Crochet expected to start' },
          { time: '5:18 PM', note: 'Officially confirmed via Red Sox lineup' },
          { time: '5:20 PM', note: 'Pitcher confirmation alert triggered' },
        ],
        affectedPlayers: [
          { name: 'Aaron Judge', playerId: 592450, teamId: 147, team: 'NYY', position: 'RF' },
          { name: 'Juan Soto', playerId: 665742, teamId: 147, team: 'NYY', position: 'LF' },
          { name: 'Giancarlo Stanton', teamId: 147, team: 'NYY', position: 'DH' },
        ],
        relatedProps: [
          { player: 'Garrett Crochet', playerId: 667579, prop: 'Strikeouts', line: '6.5', side: 'Over', confidence: 79, matchupScore: 7.9 },
          { player: 'Aaron Judge', playerId: 592450, prop: 'Home Runs', line: '0.5', side: 'Over', confidence: 86, matchupScore: 8.7 },
        ],
      },
      {
        id: 'a3', category: 'WEATHER', severity: 'IMPORTANT',
        title: 'Wind increased to 8 mph out to RF', detail: 'Wind shifted slightly and increased. Mild boost to RHB HR props and park run environment.',
        time: '12m ago', impactLevel: 'MODERATE', dataStatus: 'PROJECTED',
        beforeValue: '5 mph Out to RF', afterValue: '8 mph Out to RF',
        affectedTeam: 'Yankees', affectedTeamId: 147,
        impactAreas: ['HR Props', 'Total Bases', 'Game Total', 'Park/Weather', 'Power Hitters'],
        whyItMatters: 'Wind blowing out to right field increases carry on batted balls, which can slightly boost home-run probability especially for right-handed pull hitters. The effect is modest at 8 mph but worth tracking if wind increases further.',
        timeline: [
          { time: '6:10 PM', note: 'Wind reading: 5 mph out to right' },
          { time: '6:32 PM', note: 'Wind speed measurement updated' },
          { time: '6:41 PM', note: 'Wind increased to 8 mph out to RF' },
          { time: '6:44 PM', note: 'Weather threshold alert triggered' },
        ],
        relatedProps: [
          { player: 'Aaron Judge', playerId: 592450, prop: 'Home Runs', line: '0.5', side: 'Over', confidence: 86, matchupScore: 8.7 },
          { player: 'Rafael Devers', playerId: 646240, prop: 'Total Bases', line: '1.5', side: 'Over', confidence: 82, matchupScore: 8.4 },
        ],
      },
      {
        id: 'a4', category: 'ODDS', severity: 'INFO',
        title: 'NYY moneyline shortened', detail: 'Yankees moneyline moved 5 cents toward New York in the past hour. Small but notable shift.',
        time: '25m ago', impactLevel: 'LOW', dataStatus: 'MOCK',
        beforeValue: '-165', afterValue: '-170',
        affectedTeam: 'Yankees', affectedTeamId: 147,
        impactAreas: ['Moneyline', 'Win Probability', 'BOS Value', 'Implied Probability'],
        whyItMatters: 'Market shortening of the NYY line suggests sportsbooks or sharp action moving toward the Yankees. This does not override the DeepSide model projection. It can indicate lineup, injury, or weather-related adjustments by the market.',
        timeline: [
          { time: '3:00 PM', note: 'Opening line: NYY -160' },
          { time: '5:30 PM', note: 'Line moved to -165' },
          { time: '6:50 PM', note: 'Line shortened further to -170' },
          { time: '6:52 PM', note: 'Odds movement alert triggered' },
        ],
        relatedProps: [
          { player: 'Aaron Judge', playerId: 592450, prop: 'Home Runs', line: '0.5', side: 'Over', confidence: 86, matchupScore: 8.7 },
        ],
      },
      {
        id: 'a5', category: 'INJURY', severity: 'IMPORTANT',
        title: 'Gleyber Torres questionable', detail: 'Lower body soreness. Currently in the lineup but status is not guaranteed for game time.',
        time: '45m ago', impactLevel: 'MODERATE', dataStatus: 'REAL_MLB',
        beforeValue: 'Active', afterValue: 'Questionable',
        affectedTeam: 'Yankees', affectedTeamId: 147,
        affectedPlayer: 'Gleyber Torres', affectedPlayerId: 657136,
        impactAreas: ['Lineup', 'Projected PA', 'Player Props', 'Team Offense', '2B Position'],
        whyItMatters: 'If Torres is limited or scratched, the Yankees projected lineup changes. His plate appearances and related props (Hits, Total Bases) would be affected. A replacement hitter in his batting order slot would alter the team offensive profile.',
        timeline: [
          { time: '3:15 PM', note: 'Torres limited in batting practice' },
          { time: '4:00 PM', note: 'Media reports lower body soreness' },
          { time: '5:30 PM', note: 'Listed as questionable on injury report' },
          { time: '5:35 PM', note: 'Alert triggered on DeepSide' },
        ],
        affectedPlayers: [
          { name: 'Gleyber Torres', playerId: 657136, teamId: 147, team: 'NYY', position: '2B' },
        ],
        relatedProps: [
          { player: 'Gleyber Torres', playerId: 657136, prop: 'Hits', line: '0.5', side: 'Over', confidence: 62, matchupScore: 6.1 },
          { player: 'Gleyber Torres', playerId: 657136, prop: 'Total Bases', line: '1.5', side: 'Over', confidence: 59, matchupScore: 5.8 },
        ],
      },
    ],
    gameOdds: {
      awayMoneyline: '+145', homeMoneyline: '-170',
      awayRunLine: '+1.5', awayRunLineOdds: '-135',
      homeRunLine: '-1.5', homeRunLineOdds: '+115',
      total: '8.5', overOdds: '-110', underOdds: '-110',
      impliedProbAway: 40.8, impliedProbHome: 63.0,
    },
    headToHead: [
      { date: 'May 13', score: 'BOS 4 - 2 NYY', winner: 'Red Sox', stadium: 'Yankee Stadium', awayPitcherNote: 'Garrett Crochet (W) 6.0 IP, 2 ER, 7 K', homePitcherNote: 'Carlos Rodón (L) 5.1 IP, 3 ER, 6 K' },
      { date: 'May 12', score: 'NYY 7 - 1 BOS', winner: 'Yankees', stadium: 'Yankee Stadium', awayPitcherNote: 'Max Fried (W) 7.0 IP, 1 ER, 10 K', homePitcherNote: 'Marcus Stroman (L) 5.0 IP, 4 ER, 3 K' },
      { date: 'May 11', score: 'NYY 5 - 3 BOS', winner: 'Yankees', stadium: 'Yankee Stadium', awayPitcherNote: 'Clay Holmes (W) 1.1 IP, 0 ER, 2 K', homePitcherNote: 'Chris Martin (L) 0.2 IP, 2 ER, 1 K' },
      { date: 'May 10', score: 'BOS 6 - 5 NYY', winner: 'Red Sox', stadium: 'Fenway Park', awayPitcherNote: 'Kenley Jansen (W) 1.0 IP, 0 ER, 1 K', homePitcherNote: 'Tommy Kahnle (L) 0.1 IP, 1 ER, 0 K' },
      { date: 'May 9', score: 'NYY 9 - 4 BOS', winner: 'Yankees', stadium: 'Fenway Park', awayPitcherNote: 'Max Fried (W) 6.0 IP, 2 ER, 8 K', homePitcherNote: 'Tanner Houck (L) 4.0 IP, 4 ER, 5 K' },
    ],
    weather: { stadium: 'Yankee Stadium', city: 'Bronx, NY', temperature: '72°F', condition: 'Clear', windSpeed: '8 mph', windDirection: 'Out to RF', humidity: '61%', rainChance: '10%', parkFactor: '108', hrFactor: '1.12', runFactor: '1.08', fbFactor: '105', kFactor: '95', parkDescription: 'Hitter Friendly Overall' },
    edges: [
      { label: 'Starting Pitching', away: 'Red Sox', home: 'Yankees' },
      { label: 'Bullpen', away: 'Red Sox', home: 'Yankees' },
      { label: 'Offense', away: 'Red Sox', home: 'Yankees' },
      { label: 'Recent Form', away: 'Red Sox', home: 'Yankees' },
      { label: 'Home Field', away: 'Red Sox', home: 'Yankees' },
      { label: 'Weather', away: 'Red Sox', home: 'Yankees' },
      { label: 'Power', away: 'Red Sox', home: 'Yankees' },
      { label: 'Plate Discipline', away: 'Red Sox', home: 'Yankees' },
    ],
    insights: [
      { text: 'Yankees rank top 5 in OPS vs RHP over the last 30 days.' },
      { text: 'Boston bullpen has thrown 14.2 innings over the last 3 days.' },
      { text: 'Wind is projected out to right field at 11 mph.' },
      { text: 'Home team is 22-9 at this stadium.' },
    ],
    relevantProps: [
      { id: 'prop-1', player: 'Aaron Judge', prop: 'Over 0.5 HR', line: '0.5', l10HitRate: '70%', confidence: 84 },
      { id: 'prop-2', player: 'Juan Soto', prop: 'Over 1.5 TB', line: '1.5', l10HitRate: '73%', confidence: 79 },
      { id: 'prop-3', player: 'Carlos Rodón', prop: 'Over 6.5 K', line: '6.5', l10HitRate: '71%', confidence: 76 },
    ],
  },
  {
    id: 'dodgers-giants',
    game: {
      id: 'dodgers-giants',
      awayTeam: 'Dodgers',
      homeTeam: 'Giants',
      awayRecord: '34-26',
      homeRecord: '31-29',
      time: '8:45 PM',
      stadium: 'Oracle Park',
      weather: 'Wind out • 68°F',
      moneyline: 'LAD -155 • SF +135',
      runLine: 'LAD -1.5 • SF +1.5',
      total: '7.5',
      awayLogo: 'LAD',
      homeLogo: 'SF',
    },
    awayPitcher: {
      id: 'glasinow',
      name: 'Tyler Glasnow',
      hand: 'RHP',
      record: '4-2',
      era: '3.11',
      whip: '1.06',
      fip: '3.28',
      xfip: '3.37',
      kPercent: '31.1%',
      bbPercent: '6.9%',
      kbb: '4.5',
      hrPer9: '0.94',
      baa: '.223',
      hardHit: '35.4%',
      gb: '47.8%',
      recent5Era: '2.74',
      photo: 'TG',
    },
    homePitcher: {
      id: 'snell',
      name: 'Blake Snell',
      hand: 'LHP',
      record: '3-3',
      era: '2.87',
      whip: '1.02',
      fip: '3.08',
      xfip: '3.29',
      kPercent: '32.8%',
      bbPercent: '7.2%',
      kbb: '4.6',
      hrPer9: '0.89',
      baa: '.214',
      hardHit: '33.6%',
      gb: '49.2%',
      recent5Era: '2.61',
      photo: 'BS',
    },
    awayLineup: [
      { id: 'd1', name: 'Mookie Betts', order: 1, position: 'RF', hand: 'R', avg: '.301', obp: '.383', slg: '.542', ops: '.925', hr: 12, rbi: 40, last10Ops: '.956', strong: true },
      { id: 'd2', name: 'Shohei Ohtani', order: 2, position: 'DH', hand: 'L', avg: '.291', obp: '.378', slg: '.612', ops: '.990', hr: 25, rbi: 54, last10Ops: '1.042', strong: true },
    ],
    homeLineup: [
      { id: 'g1', name: 'Jung Hoo Lee', order: 1, position: 'CF', hand: 'L', avg: '.269', obp: '.330', slg: '.435', ops: '.765', hr: 7, rbi: 21, last10Ops: '.847', strong: false },
      { id: 'g2', name: 'Matt Chapman', order: 2, position: '3B', hand: 'R', avg: '.247', obp: '.318', slg: '.449', ops: '.767', hr: 11, rbi: 33, last10Ops: '.823', strong: false },
    ],
    awaySplit: { team: 'Dodgers', vs: 'LHP', avg: '.260', obp: '.334', slg: '.452', ops: '.786', woba: '.333', wrcPlus: '114', kPercent: '21.5%', bbPercent: '8.2%', iso: '.192', hrRate: '3.1%' },
    homeSplit: { team: 'Giants', vs: 'RHP', avg: '.244', obp: '.312', slg: '.420', ops: '.732', woba: '.311', wrcPlus: '101', kPercent: '23.4%', bbPercent: '7.4%', iso: '.176', hrRate: '2.8%' },
    awayBullpen: { era: '3.02', fip: '3.39', whip: '1.11', kPercent: '25.8%', bbPercent: '8.1%', hrPer9: '1.03', savePercent: '78%', last3Days: '6.2 IP', last7Days: '12.4 IP', fatigue: 'Fresh' },
    homeBullpen: { era: '3.49', fip: '3.61', whip: '1.21', kPercent: '23.2%', bbPercent: '9.3%', hrPer9: '1.14', savePercent: '74%', last3Days: '7.9 IP', last7Days: '15.1 IP', fatigue: 'Moderate' },
    awayForm: { last5: '4-1', last10: '7-3', streak: 'W4', runsPerGame: '5.1', runsAllowed: '3.9', homeRecord: '16-12', awayRecord: '18-14' },
    homeForm: { last5: '2-3', last10: '4-6', streak: 'L2', runsPerGame: '4.3', runsAllowed: '4.7', homeRecord: '17-13', awayRecord: '14-16' },
    headToHead: [
      { date: 'Jun 11', score: 'LAD 5 - SF 2', winner: 'Dodgers', stadium: 'Oracle Park' },
      { date: 'Jun 7', score: 'LAD 3 - SF 6', winner: 'Giants', stadium: 'Dodger Stadium' },
    ],
    weather: { stadium: 'Oracle Park', city: 'San Francisco, CA', temperature: '68°F', condition: 'Windy', windSpeed: '11 mph', windDirection: 'Out to RF', humidity: '67%', rainChance: '5%', parkFactor: '105', hrFactor: '1.08', runFactor: '1.04' },
    edges: [
      { label: 'Starting Pitching', away: 'Dodgers', home: 'Giants' },
      { label: 'Bullpen', away: 'Dodgers', home: 'Giants' },
      { label: 'Offense', away: 'Dodgers', home: 'Giants' },
      { label: 'Recent Form', away: 'Dodgers', home: 'Giants' },
      { label: 'Home Field', away: 'Dodgers', home: 'Giants' },
      { label: 'Weather', away: 'Dodgers', home: 'Giants' },
      { label: 'Power', away: 'Dodgers', home: 'Giants' },
      { label: 'Plate Discipline', away: 'Dodgers', home: 'Giants' },
    ],
    insights: [
      { text: 'Dodgers are posting a 1.005 OPS across the last 14 days.' },
      { text: 'Giants bullpen has logged 7.9 innings over the last 3 days.' },
      { text: 'Strong wind favors the ball carrying out to right.' },
    ],
    relevantProps: [
      { id: 'prop-d1', player: 'Shohei Ohtani', prop: 'Over 1.5 TB', line: '1.5', l10HitRate: '74%', confidence: 81 },
      { id: 'prop-d2', player: 'Mookie Betts', prop: 'Over 0.5 HR', line: '0.5', l10HitRate: '68%', confidence: 72 },
    ],
  },
];
