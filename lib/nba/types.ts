export interface NBATeam {
  id: number;
  name: string;
  displayName: string;
  abbreviation: string;
  logoUrl: string | null;
}

export interface NBAPlayer {
  id: number;
  name: string;
  position: string | null;
  team: NBATeam | null;
  jersey: string | null;
  headshotUrl: string | null;
}

export interface NBAGame {
  id: string;
  gameTime: string;
  seasonId?: string | null;
  season?: number | null;
  phase?: 'PRESEASON' | 'REGULAR' | 'PLAY_IN' | 'POSTSEASON' | 'UNKNOWN';
  round?: string | null;
  homeTeam: NBATeam;
  awayTeam: NBATeam;
  homeScore: number | null;
  awayScore: number | null;
  completed: boolean;
}

export type NBAGameStatMap = Record<string, number>;

export interface NBAGameLogEntry {
  gameId: string;
  date: string;
  season?: number | null;
  phase?: 'PRESEASON' | 'REGULAR' | 'PLAY_IN' | 'POSTSEASON' | 'UNKNOWN';
  round?: string | null;
  opponent: string;
  opponentAbbreviation: string;
  homeAway: 'home' | 'away';
  result: string | null;
  stats: NBAGameStatMap;
}
