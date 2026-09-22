export type MLBRange = 'L5' | 'L10' | 'L20' | 'L40' | '2026' | '2025';
export type PropMarket = 'hits' | 'totalBases' | 'homeRuns' | 'runs' | 'rbi' | 'hitsRunsRBI' | 'strikeouts' | 'hitsAllowed' | 'earnedRuns' | 'outsRecorded';
export type PropSide = 'Over' | 'Under';

export interface MLBTeam {
  id: number;
  name: string;
  abbreviation: string;
  league: string;
  division: string;
  teamLogoUrl?: string | null;
}

export interface MLBTeamSummary {
  id: number;
  name: string;
  abbreviation: string;
  record?: MLBTeamRecord | null;
}

export interface MLBTeamRecord {
  wins: number;
  losses: number;
  pct: string | null;
  home?: string | null;
  away?: string | null;
}

export interface MLBVenue {
  id: string;
  stadiumName: string;
  city: string;
  state: string;
  timezone: string;
  parkFactor?: number | null;
  hrFactor?: number | null;
  runFactor?: number | null;
}

export interface MLBProbablePitcher {
  id: number;
  name: string;
  throwingHand: string | null;
  era?: number | null;
  whip?: number | null;
  fip?: number | null;
  kPct?: number | null;
  bbPct?: number | null;
  hrPer9?: number | null;
  baa?: number | null;
}

export interface MLBGame {
  id: string;
  date: string;
  gameTime: string;
  awayTeam: MLBTeamSummary;
  homeTeam: MLBTeamSummary;
  status: string;
  venue?: MLBVenue | null;
  venueId?: string | null;
  awayProbableStarter?: MLBProbablePitcher | null;
  homeProbableStarter?: MLBProbablePitcher | null;
}

export interface MLBPlayer {
  id: number;
  name: string;
  currentTeam?: MLBTeamSummary | null;
  position?: string | null;
  batSide?: string | null;
  throwSide?: string | null;
  jerseyNumber?: number | null;
  height?: string | null;
  weight?: number | null;
  playerImageUrl?: string | null;
}

export interface MLBGameLog {
  date: string;
  opponent: string;
  homeAway: string;
  /** Every stat below is `null` when the MLB Stats API genuinely omitted the field for this game — never silently coerced to 0. Absent (undefined) for stats that don't apply to this game's group (hitting vs pitching). */
  plateAppearances?: number | null;
  atBats?: number | null;
  hits?: number | null;
  doubles?: number | null;
  triples?: number | null;
  homeRuns?: number | null;
  runs?: number | null;
  rbi?: number | null;
  walks?: number | null;
  strikeouts?: number | null;
  totalBases?: number | null;
  inningsPitched?: number | null;
  hitsAllowed?: number | null;
  earnedRuns?: number | null;
  homeRunsAllowed?: number | null;
  pitches?: number | null;
}

export interface HitRateResult {
  hits: number;
  games: number;
  percentage: number;
}
