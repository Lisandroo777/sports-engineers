export type DashboardSport = 'MLB' | 'NBA' | 'NFL' | 'NHL' | 'Soccer' | 'UFC';

export interface DashboardGame {
  id: string;
  awayTeam: string;
  awayTeamId?: number;
  awayRecord: string;
  homeTeam: string;
  homeTeamId?: number;
  homeRecord: string;
  time: string;
  stadium: string;
  /** Away pitcher display name (abbreviated) */
  awayPitcherName?: string;
  awayPitcherEra?: string;
  /** Home pitcher display name (abbreviated) */
  homePitcherName?: string;
  homePitcherEra?: string;
  /** Legacy joined strings kept for backward compat */
  probablePitchers?: string[];
  pitcherEra?: string;
  weather: string;
  weatherIcon?: string;
}

export interface DashboardOpportunity {
  id: string;
  player: string;
  playerId?: number;
  team: string;
  teamId?: number;
  opponent: string;
  prop: string;
  line: string;
  side: string;
  confidence: number;
  l5: number;
  l10: number;
  l20: number;
  projectedValue: number;
  avatar: string;
  odds?: string;
  /** One-sentence beginner-friendly rationale (mock) */
  rationale?: string;
}

export interface DashboardMarketMover {
  id: string;
  player: string;
  playerId?: number;
  teamId?: number;
  prop: string;
  line: string;
  openingOdds: string;
  currentOdds: string;
  direction: 'up' | 'down';
  movement: string;
  /** Short market narrative */
  movementLabel?: string;
}

export interface DashboardResearchItem {
  id: string;
  player: string;
  playerId?: number;
  teamId?: number;
  prop: string;
  line: string;
  lastViewed: string;
  confidence: number;
}

export interface DashboardAlert {
  id: string;
  time: string;
  type: string;
  message: string;
  tone: 'positive' | 'neutral' | 'warning';
  category?: 'LINEUP' | 'WEATHER' | 'PITCHER' | 'INJURY' | 'MARKET';
}

export interface DashboardInjuryUpdate {
  id: string;
  player: string;
  playerId?: number;
  teamId?: number;
  status: string;
  detail: string;
}

export interface DashboardSavedPick {
  id: string;
  player: string;
  playerId?: number;
  teamId?: number;
  prop: string;
  side?: string;
  line?: string;
  confidence: number;
  odds?: string;
}

export interface DashboardQuickPlayer {
  id: string;
  name: string;
  playerId?: number;
  team: string;
  teamId?: number;
  position: string;
  avatar: string;
}

export interface DashboardSectionData {
  summary: {
    gamesToday: number;
    propsTracked: number;
    highConfidenceProps: number;
    savedPicks: number;
    marketMovers: number;
    importantAlerts: number;
  };
  games: DashboardGame[];
  opportunities: DashboardOpportunity[];
  marketMovers: DashboardMarketMover[];
  recentResearch: DashboardResearchItem[];
  alerts: DashboardAlert[];
  injuryNews: DashboardInjuryUpdate[];
  savedPicks: DashboardSavedPick[];
  quickPlayers: DashboardQuickPlayer[];
}

export const sportOptions: DashboardSport[] = ['MLB', 'NBA', 'NFL', 'NHL', 'Soccer', 'UFC'];

// MLB team IDs (official MLB Stats API IDs)
export const MLB_TEAM_IDS: Record<string, number> = {
  NYY: 147, BOS: 111, LAD: 119, SFG: 137, HOU: 117, TEX: 140,
  ATL: 144, NYM: 121, PHI: 143, MIA: 146, PIT: 134, CHC: 112,
  BAL: 110, TBR: 139, CLE: 114, CWS: 145, MIN: 142, DET: 116,
  TOR: 141, LAA: 108, SEA: 136, KCR: 118, OAK: 133, HOU2: 117,
  COL: 115, STL: 138, MIL: 158, CIN: 113, WSN: 120, ARI: 109,
  SDP: 135, OAK2: 133,
};

export const dashboardData: Record<DashboardSport, DashboardSectionData> = {
  MLB: {
    summary: {
      gamesToday: 15,
      propsTracked: 482,
      highConfidenceProps: 27,
      savedPicks: 6,
      marketMovers: 5,
      importantAlerts: 3,
    },
    games: [
      {
        id: 'mlb-1',
        awayTeam: 'Yankees', awayTeamId: 147, awayRecord: '37-22',
        homeTeam: 'Red Sox', homeTeamId: 111, homeRecord: '28-30',
        time: '7:10 PM', stadium: 'Fenway Park',
        awayPitcherName: 'C. Rodón', awayPitcherEra: '3.92',
        homePitcherName: 'G. Crochet', homePitcherEra: '3.74',
        probablePitchers: ['Garrett Crochet', 'Carlos Rodón'], pitcherEra: '3.74 / 3.92',
        weather: 'Clear • 72°F', weatherIcon: '☀️',
      },
      {
        id: 'mlb-2',
        awayTeam: 'Dodgers', awayTeamId: 119, awayRecord: '34-26',
        homeTeam: 'Giants', homeTeamId: 137, homeRecord: '31-29',
        time: '8:45 PM', stadium: 'Oracle Park',
        awayPitcherName: 'B. Snell', awayPitcherEra: '2.87',
        homePitcherName: 'T. Glasnow', homePitcherEra: '3.11',
        probablePitchers: ['Blake Snell', 'Tyler Glasnow'], pitcherEra: '2.87 / 3.11',
        weather: 'Wind out • 68°F', weatherIcon: '🌬️',
      },
      {
        id: 'mlb-3',
        awayTeam: 'Astros', awayTeamId: 117, awayRecord: '33-27',
        homeTeam: 'Rangers', homeTeamId: 140, homeRecord: '29-30',
        time: '6:35 PM', stadium: 'Globe Life Field',
        awayPitcherName: 'H. Brown', awayPitcherEra: '3.34',
        homePitcherName: 'N. Eovaldi', homePitcherEra: '3.67',
        probablePitchers: ['Hunter Brown', 'Nathan Eovaldi'], pitcherEra: '3.34 / 3.67',
        weather: 'Indoor • 72°F', weatherIcon: '🏟️',
      },
      {
        id: 'mlb-4',
        awayTeam: 'Braves', awayTeamId: 144, awayRecord: '31-29',
        homeTeam: 'Mets', homeTeamId: 121, homeRecord: '35-24',
        time: '7:15 PM', stadium: 'Citi Field',
        awayPitcherName: 'C. Sale', awayPitcherEra: '3.17',
        homePitcherName: 'S. Manaea', homePitcherEra: '3.98',
        probablePitchers: ['Chris Sale', 'Sean Manaea'], pitcherEra: '3.17 / 3.98',
        weather: 'Cloudy • 70°F', weatherIcon: '☁️',
      },
      {
        id: 'mlb-5',
        awayTeam: 'Phillies', awayTeamId: 143, awayRecord: '36-23',
        homeTeam: 'Marlins', homeTeamId: 146, homeRecord: '24-32',
        time: '5:40 PM', stadium: 'LoanDepot Park',
        awayPitcherName: 'Z. Wheeler', awayPitcherEra: '2.58',
        homePitcherName: 'E. Cabrera', homePitcherEra: '4.51',
        probablePitchers: ['Zack Wheeler', 'Edward Cabrera'], pitcherEra: '2.58 / 4.51',
        weather: 'Humid • 81°F', weatherIcon: '🌡️',
      },
    ],
    opportunities: [
      {
        id: 'opp-1', player: 'Aaron Judge', playerId: 592450, team: 'NYY', teamId: 147,
        opponent: 'BOS', prop: 'Home Runs', line: '0.5', side: 'Over',
        confidence: 86, l5: 80, l10: 70, l20: 75, projectedValue: 8.4, avatar: 'AJ', odds: '-120',
        rationale: 'Hit this market in 4 of last 5 and faces a high-ERA starter.',
      },
      {
        id: 'opp-2', player: 'Shohei Ohtani', playerId: 660271, team: 'LAD', teamId: 119,
        opponent: 'SFG', prop: 'Total Bases', line: '1.5', side: 'Over',
        confidence: 81, l5: 76, l10: 74, l20: 79, projectedValue: 7.9, avatar: 'SO', odds: '-110',
        rationale: 'Strong recent multi-hit games, favorable wind conditions at Oracle.',
      },
      {
        id: 'opp-3', player: 'Austin Riley', playerId: 663586, team: 'ATL', teamId: 144,
        opponent: 'NYM', prop: 'Home Runs', line: '0.5', side: 'Over',
        confidence: 76, l5: 74, l10: 71, l20: 72, projectedValue: 7.1, avatar: 'AR', odds: '+105',
        rationale: 'Elevated power output over the last two weeks at value odds.',
      },
      {
        id: 'opp-4', player: 'Yordan Alvarez', playerId: 670541, team: 'HOU', teamId: 117,
        opponent: 'TEX', prop: 'Home Runs', line: '0.5', side: 'Over',
        confidence: 74, l5: 71, l10: 68, l20: 70, projectedValue: 6.8, avatar: 'YA', odds: '-115',
        rationale: 'Consistent power threat in a dome — weather is not a factor.',
      },
      {
        id: 'opp-5', player: 'Kyle Schwarber', playerId: 656941, team: 'PHI', teamId: 143,
        opponent: 'MIA', prop: 'Home Runs', line: '0.5', side: 'Over',
        confidence: 72, l5: 68, l10: 66, l20: 71, projectedValue: 6.2, avatar: 'KS', odds: '+100',
        rationale: 'Marlins opposing starter has allowed 8 HRs in his last 6 starts.',
      },
    ],
    marketMovers: [
      {
        id: 'mover-1', player: 'Juan Soto', playerId: 665742, teamId: 147,
        prop: 'Over 1.5 TB', line: '1.5', openingOdds: '-105', currentOdds: '-135',
        direction: 'down', movement: '-0.5', movementLabel: 'Market moving toward the Over',
      },
      {
        id: 'mover-2', player: 'Rafael Devers', playerId: 646240, teamId: 111,
        prop: 'Over 0.5 HR', line: '0.5', openingOdds: '+110', currentOdds: '-125',
        direction: 'down', movement: '-0.4', movementLabel: 'Sharp money pushed price down',
      },
      {
        id: 'mover-3', player: 'Pete Alonso', playerId: 624413, teamId: 121,
        prop: 'Over 0.5 HR', line: '0.5', openingOdds: '+100', currentOdds: '+120',
        direction: 'up', movement: '+0.4', movementLabel: 'Market softening — value grew',
      },
      {
        id: 'mover-4', player: 'Corbin Carroll', playerId: 682998, teamId: 109,
        prop: 'Over 1.5 TB', line: '1.5', openingOdds: '+85', currentOdds: '+105',
        direction: 'up', movement: '+0.3', movementLabel: 'Line movement suggests public lean',
      },
      {
        id: 'mover-5', player: 'Gunnar Henderson', playerId: 683002, teamId: 110,
        prop: 'Over 1.5 TB', line: '1.5', openingOdds: '-95', currentOdds: '-110',
        direction: 'down', movement: '-0.3', movementLabel: 'Consistent action toward the Over',
      },
    ],
    recentResearch: [
      { id: 'recent-1', player: 'Aaron Judge', playerId: 592450, teamId: 147, prop: 'Home Runs', line: '0.5', lastViewed: '12m ago', confidence: 86 },
      { id: 'recent-2', player: 'Shohei Ohtani', playerId: 660271, teamId: 119, prop: 'Total Bases', line: '1.5', lastViewed: '34m ago', confidence: 81 },
      { id: 'recent-3', player: 'Juan Soto', playerId: 665742, teamId: 147, prop: 'Hits', line: '0.5', lastViewed: '1h ago', confidence: 79 },
      { id: 'recent-4', player: 'Paul Skenes', playerId: 694973, teamId: 134, prop: 'Strikeouts', line: '6.5', lastViewed: '2h ago', confidence: 77 },
    ],
    alerts: [
      { id: 'alert-1', time: '5m ago', type: 'Lineup', message: 'Yankees lineup confirmed; Judge batting 2nd', tone: 'positive', category: 'LINEUP' },
      { id: 'alert-2', time: '18m ago', type: 'Weather', message: 'Wind increased at Oracle Park, pushing totals up', tone: 'neutral', category: 'WEATHER' },
      { id: 'alert-3', time: '32m ago', type: 'Pitcher', message: 'Starting pitcher changed for Marlins matchup', tone: 'warning', category: 'PITCHER' },
    ],
    injuryNews: [
      { id: 'injury-1', player: 'Juan Soto', playerId: 665742, teamId: 147, status: 'Active', detail: 'Expected to start' },
      { id: 'injury-2', player: 'Gleyber Torres', teamId: 147, status: 'Questionable', detail: 'Lower body soreness' },
      { id: 'injury-3', player: 'Luis Castillo', teamId: 136, status: 'Out', detail: 'Back tightness' },
    ],
    savedPicks: [
      { id: 'saved-1', player: 'Aaron Judge', playerId: 592450, teamId: 147, prop: 'Home Runs', side: 'Over', line: '0.5', confidence: 86, odds: '-120' },
      { id: 'saved-2', player: 'Shohei Ohtani', playerId: 660271, teamId: 119, prop: 'Total Bases', side: 'Over', line: '1.5', confidence: 81, odds: '-110' },
      { id: 'saved-3', player: 'Paul Skenes', playerId: 694973, teamId: 134, prop: 'Strikeouts', side: 'Over', line: '6.5', confidence: 77, odds: '-115' },
    ],
    quickPlayers: [
      { id: 'player-1', name: 'Aaron Judge', playerId: 592450, team: 'Yankees', teamId: 147, position: 'OF', avatar: 'AJ' },
      { id: 'player-2', name: 'Shohei Ohtani', playerId: 660271, team: 'Dodgers', teamId: 119, position: 'DH', avatar: 'SO' },
      { id: 'player-3', name: 'Paul Skenes', playerId: 694973, team: 'Pirates', teamId: 134, position: 'SP', avatar: 'PS' },
    ],
  },
  NBA: {
    summary: { gamesToday: 10, propsTracked: 311, highConfidenceProps: 19, savedPicks: 4, marketMovers: 2, importantAlerts: 1 },
    games: [
      { id: 'nba-1', awayTeam: 'Celtics', awayRecord: '44-18', homeTeam: 'Knicks', homeRecord: '38-24', time: '7:30 PM', stadium: 'Madison Square Garden', weather: 'Indoor' },
    ],
    opportunities: [
      { id: 'opp-nba-1', player: 'Jayson Tatum', team: 'BOS', opponent: 'NYK', prop: 'Points', line: '26.5', side: 'Over', confidence: 78, l5: 74, l10: 73, l20: 75, projectedValue: 6.8, avatar: 'JT', rationale: 'Averaging 29.4 PPG over his last 5 games.' },
    ],
    marketMovers: [],
    recentResearch: [],
    alerts: [],
    injuryNews: [],
    savedPicks: [],
    quickPlayers: [],
  },
  NFL: {
    summary: { gamesToday: 12, propsTracked: 298, highConfidenceProps: 16, savedPicks: 3, marketMovers: 3, importantAlerts: 2 },
    games: [
      { id: 'nfl-1', awayTeam: 'Bills', awayRecord: '5-2', homeTeam: 'Chiefs', homeRecord: '5-1', time: '1:00 PM', stadium: 'Arrowhead Stadium', weather: 'Cool • 58°F', weatherIcon: '🌤️' },
    ],
    opportunities: [
      { id: 'opp-nfl-1', player: 'Josh Allen', team: 'BUF', opponent: 'KC', prop: 'Passing Yards', line: '287.5', side: 'Over', confidence: 76, l5: 72, l10: 69, l20: 73, projectedValue: 6.1, avatar: 'JA', rationale: 'Allen has gone over this total in 4 of his last 5 road starts.' },
    ],
    marketMovers: [],
    recentResearch: [],
    alerts: [],
    injuryNews: [],
    savedPicks: [],
    quickPlayers: [],
  },
  NHL: {
    summary: { gamesToday: 8, propsTracked: 221, highConfidenceProps: 12, savedPicks: 2, marketMovers: 1, importantAlerts: 0 },
    games: [
      { id: 'nhl-1', awayTeam: 'Maple Leafs', awayRecord: '39-23', homeTeam: 'Bruins', homeRecord: '34-26', time: '7:00 PM', stadium: 'TD Garden', weather: 'Indoor' },
    ],
    opportunities: [
      { id: 'opp-nhl-1', player: 'Auston Matthews', team: 'TOR', opponent: 'BOS', prop: 'Shots on Goal', line: '3.5', side: 'Over', confidence: 73, l5: 69, l10: 70, l20: 71, projectedValue: 5.7, avatar: 'AM', rationale: 'Averaging 4.8 shots per game over the last 10 games.' },
    ],
    marketMovers: [],
    recentResearch: [],
    alerts: [],
    injuryNews: [],
    savedPicks: [],
    quickPlayers: [],
  },
  Soccer: {
    summary: { gamesToday: 9, propsTracked: 184, highConfidenceProps: 10, savedPicks: 2, marketMovers: 2, importantAlerts: 1 },
    games: [
      { id: 'soccer-1', awayTeam: 'Inter Miami', awayRecord: '12-4-1', homeTeam: 'LAFC', homeRecord: '11-5-2', time: '10:30 PM', stadium: 'BMO Stadium', weather: 'Clear • 68°F', weatherIcon: '☀️' },
    ],
    opportunities: [
      { id: 'opp-soccer-1', player: 'Lionel Messi', team: 'MIA', opponent: 'LAFC', prop: 'Shots on Target', line: '2.5', side: 'Over', confidence: 72, l5: 68, l10: 70, l20: 69, projectedValue: 5.4, avatar: 'LM', rationale: 'Messi has 3+ shots on target in 4 of 5 recent matches.' },
    ],
    marketMovers: [],
    recentResearch: [],
    alerts: [],
    injuryNews: [],
    savedPicks: [],
    quickPlayers: [],
  },
  UFC: {
    summary: { gamesToday: 3, propsTracked: 97, highConfidenceProps: 6, savedPicks: 1, marketMovers: 1, importantAlerts: 0 },
    games: [
      { id: 'ufc-1', awayTeam: 'Volkanovski', awayRecord: '26-3', homeTeam: 'Topuria', homeRecord: '15-0', time: '10:00 PM', stadium: 'T-Mobile Arena', weather: 'Indoor' },
    ],
    opportunities: [
      { id: 'opp-ufc-1', player: 'Alexander Volkanovski', team: '', opponent: 'Topuria', prop: 'Fight Goes to Decision', line: '', side: 'Yes', confidence: 71, l5: 67, l10: 69, l20: 68, projectedValue: 5.2, avatar: 'AV', rationale: 'Both fighters have a low finishing rate in recent contests.' },
    ],
    marketMovers: [],
    recentResearch: [],
    alerts: [],
    injuryNews: [],
    savedPicks: [],
    quickPlayers: [],
  },
};

