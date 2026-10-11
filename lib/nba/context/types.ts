export type NBAMarket = 'points' | 'rebounds' | 'assists' | '3pm' | 'pra' | 'pr' | 'pa' | 'ra' | 'steals' | 'blocks' | 'turnovers' | 'minutes';
export type EvidenceKind = 'FACT' | 'DERIVED' | 'INFERENCE' | 'UNAVAILABLE';
export type EvidenceState = 'AVAILABLE' | 'PARTIAL' | 'UNKNOWN' | 'UNAVAILABLE' | 'CONFLICTED';
export type Phase = 'PRESEASON' | 'REGULAR' | 'POSTSEASON' | 'UNKNOWN';
export type Reliability = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export interface SourceReference {
  id: string;
  provider: 'ESPN';
  url: string;
  recordId: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  fetchedAt: string;
  freshness: 'FRESH' | 'STALE' | 'UNKNOWN' | 'AFTER_CUTOFF';
}

export interface SampleDescription {
  gameIds: string[];
  from: string | null;
  to: string | null;
  seasonId: string;
  phase: Phase;
  conditions: string[];
  measured: number;
  eligible: number;
  excluded: string[];
}

export interface NBAEvidence {
  id: string;
  kind: EvidenceKind;
  state: EvidenceState;
  metric: string;
  value: JsonValue;
  units: string | null;
  detail: string;
  direction: 'HELPS' | 'HURTS' | 'NEUTRAL' | 'UNKNOWN';
  directionBasis: string | null;
  markets: NBAMarket[];
  reliability: Reliability;
  reliabilityReasons: string[];
  sourceRefs: SourceReference[];
  sample: SampleDescription | null;
  missingReasons: string[];
  dependencyIds: string[];
  correlationGroup: string;
}

export interface ContextStats {
  minutes: number | null; points: number | null; rebounds: number | null;
  assists: number | null; steals: number | null; blocks: number | null; turnovers: number | null;
  fgm: number | null; fga: number | null; tpm: number | null; tpa: number | null;
  ftm: number | null; fta: number | null; oreb: number | null; dreb: number | null; fouls: number | null;
}

export interface PlayerObservation {
  playerId: number;
  name: string;
  starter: boolean | null;
  didNotPlay: boolean | null;
  active: boolean | null;
  dnpReason: string | null;
  ejected: boolean | null;
  stats: ContextStats;
}

export interface TeamObservation {
  teamId: number;
  players: PlayerObservation[];
  stats: ContextStats;
  paintPoints: number | null;
  rosterComplete: boolean;
  participationCoverage?: { rows: number; known: number; starters: number };
}

export interface PlayObservation {
  id: string;
  sequence: number;
  period: number | null;
  secondsRemaining: number | null;
  wallclock: string | null;
  type: string;
  text: string;
  teamId: number | null;
  participantIds: number[];
  homeScore: number | null;
  awayScore: number | null;
}

export interface ContextGame {
  gameId: string;
  seasonId: string | null;
  phase: Phase;
  startsAt: string;
  completed: boolean;
  completedAt: string | null;
  homeTeamId: number;
  awayTeamId: number;
  homeScore: number | null;
  awayScore: number | null;
  venueId: string | null;
  venueName: string | null;
  neutralSite: boolean | null;
  round: string | null;
  seriesEventIds: string[];
  teams: TeamObservation[];
  plays: PlayObservation[];
  source: SourceReference;
}

export type AvailabilityStatus = 'OUT' | 'DOUBTFUL' | 'QUESTIONABLE' | 'PROBABLE' | 'AVAILABLE' | 'NOT_REPORTED' | 'UNKNOWN';
export interface InjuryObservation {
  playerId: number | null;
  teamId: number | null;
  status: AvailabilityStatus;
  rawStatus: string;
  comment: string | null;
  source: SourceReference;
}

export interface NewsObservation {
  id: string;
  headline: string;
  text: string | null;
  playerIds: number[];
  teamIds: number[];
  source: SourceReference;
}

export interface NBAContextSnapshot {
  target: ContextGame;
  asOf: string;
  games: ContextGame[];
  calendar: ContextGame[];
  injuries: InjuryObservation[];
  injuryFeed: { state: 'AVAILABLE' | 'UNAVAILABLE'; source: SourceReference | null };
  news: NewsObservation[];
  missing: string[];
}

export interface AvailabilityContext {
  status: AvailabilityStatus;
  state: EvidenceState;
  evidenceIds: string[];
}

export interface RotationContext {
  currentStarter: 'UNKNOWN';
  restriction: 'UNKNOWN';
  recentRole: 'STARTER' | 'BENCH' | 'MIXED' | 'UNKNOWN';
  playedGames: number;
  dnpGames: number;
  missingGames: number;
  evidenceIds: string[];
}

export interface InjuryNetworkEdge {
  teammateId: number;
  currentStatus: AvailabilityStatus;
  state: EvidenceState;
  evidenceIds: string[];
  cohorts: { with: string[]; without: string[]; excluded: string[] };
  matchedOtherDnpPatterns: string[];
  confounders: string[];
}

export interface InjuryNetworkContext { edges: InjuryNetworkEdge[]; evidenceIds: string[] }
export interface ScheduleContext { homeAway: 'HOME' | 'AWAY' | 'UNKNOWN'; evidenceIds: string[] }
export interface OpponentContext { opponentTeamId: number | null; evidenceIds: string[] }
export interface SeasonContext { phase: Phase; round: string | null; progress: 'EARLY' | 'MID' | 'LATE' | 'UNKNOWN'; evidenceIds: string[] }
export interface NewsContext { evidenceIds: string[] }

export interface NBAResearchContext {
  schemaVersion: '1';
  sport: 'nba';
  playerId: number;
  teamId: number;
  gameId: string;
  seasonId: string | null;
  asOf: string;
  cutoff: string;
  sections: {
    availability: AvailabilityContext; rotation: RotationContext; injuryNetwork: InjuryNetworkContext;
    schedule: ScheduleContext; opponent: OpponentContext; season: SeasonContext; news: NewsContext;
  };
  evidence: NBAEvidence[];
  marketViews: Record<NBAMarket, { evidenceIds: string[]; missing: string[]; correlationGroups: string[]; groupedEvidence: Record<string, string[]> }>;
  coverage: { priorCompletedGames: number; playerTeamGames: number; opponentTeamGames: number; missing: string[] };
}

export interface ResearchRequest { playerId: number; teamId: number; gameId: string; asOf: string }
export interface BuildEnvironment {
  request: ResearchRequest;
  snapshot: NBAContextSnapshot;
  cutoff: string;
  games: ContextGame[];
  teamGames: ContextGame[];
  evidence: NBAEvidence[];
}