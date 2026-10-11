export interface NFLTeam {
  id: number;
  name: string;
  displayName: string;
  abbreviation: string;
  logoUrl: string | null;
  color: string | null;
}

export type NFLPosition = 'QB' | 'RB' | 'WR' | 'TE' | 'K' | 'DEF' | string;

export interface NFLPlayer {
  id: number;
  name: string;
  position: NFLPosition;
  positionName: string | null;
  team: NFLTeam | null;
  jersey: string | null;
  headshotUrl: string | null;
  age: number | null;
  height: string | null;
  weight: string | null;
}

export interface NFLGameOdds {
  provider: string;
  homeSpread: number | null;
  openingHomeSpread: number | null;
  total: number | null;
  openingTotal: number | null;
  retrievedAt: string;
}

export interface NFLGame {
  id: string;
  season?: number | null;
  week: number | null;
  seasonType?: 'REGULAR' | 'POSTSEASON' | null;
  playoffRound?: 'WILD_CARD' | 'DIVISIONAL' | 'CONFERENCE_CHAMPIONSHIP' | 'SUPER_BOWL' | null;
  gameTime: string;
  homeTeam: NFLTeam;
  awayTeam: NFLTeam;
  homeScore: number | null;
  awayScore: number | null;
  completed: boolean;
  status?: string;
  venue?: {
    id: string | null;
    name: string;
    indoor: boolean | null;
    city: string | null;
    state: string | null;
    country: string | null;
  } | null;
  odds?: NFLGameOdds[];
}

/** Raw per-game stat map from the provider, keyed by ESPN's own stat names (e.g. "passingYards"). */
export type NFLGameStatMap = Record<string, number>;

export interface NFLGameLogEntry {
  gameId: string;
  season?: number;
  teamId?: number | null;
  position?: string | null;
  roleEvidence?: Array<'PASSING' | 'RUSHING' | 'RECEIVING'>;
  started?: boolean | null;
  historySource?: 'CURRENT_SEASON' | 'PREVIOUS_SEASON';
  historyWeight?: number;
  week: number | null;
  date: string;
  opponent: string;
  opponentAbbreviation: string;
  homeAway: 'home' | 'away';
  result: string | null;
  stats: NFLGameStatMap;
}
