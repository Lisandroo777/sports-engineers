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

export interface NFLGame {
  id: string;
  week: number | null;
  gameTime: string;
  homeTeam: NFLTeam;
  awayTeam: NFLTeam;
  homeScore: number | null;
  awayScore: number | null;
  completed: boolean;
  venue?: {
    id: string | null;
    name: string;
    indoor: boolean | null;
    city: string | null;
    state: string | null;
    country: string | null;
  } | null;
}

/** Raw per-game stat map from the provider, keyed by ESPN's own stat names (e.g. "passingYards"). */
export type NFLGameStatMap = Record<string, number>;

export interface NFLGameLogEntry {
  gameId: string;
  week: number | null;
  date: string;
  opponent: string;
  opponentAbbreviation: string;
  homeAway: 'home' | 'away';
  result: string | null;
  stats: NFLGameStatMap;
}
