import type { ContextGame, NBAContextSnapshot } from '../../context/types';
import type { NBAIntelligenceSnapshot } from '../../intelligence/types';

export const GAME_MODEL_VERSION = 'NBA_GAME_LINES_V1' as const;
export type GameMarket = 'MONEYLINE' | 'SPREAD' | 'TOTAL' | 'TEAM_TOTAL';
export type GamePhase = 'REGULAR' | 'PLAY_IN' | 'POSTSEASON' | 'PRESEASON' | 'UNKNOWN';
export interface GameModelInput {
  snapshot: NBAContextSnapshot;
  predictionAt: string;
  intelligence?: NBAIntelligenceSnapshot | null;
}
export interface TeamSample {
  gameId: string;
  startsAt: string;
  home: boolean;
  scored: number;
  allowed: number;
  possessions: number;
  offensiveEfficiency: number;
  defensiveEfficiency: number;
}
export interface TeamProfile {
  teamId: number;
  sampleSize: number;
  gameIds: string[];
  offense: number;
  defense: number;
  pace: number;
  seasonScored: number;
  recentScored: number;
  venueSampleSize: number;
  scheduledRestDays: number | null;
  backToBack: boolean | null;
  restCoverage: 'PARTIAL' | 'UNAVAILABLE';
  priorVenueId: string | null;
  venueChanged: boolean | null;
}
export interface ScoreScenario { homeScore: number; awayScore: number; weight: number }
export interface GameProjection {
  modelVersion: typeof GAME_MODEL_VERSION;
  validationStatus: 'UNVALIDATED';
  status: 'AVAILABLE' | 'INSUFFICIENT_DATA' | 'UNSUPPORTED_PHASE' | 'INVALID_INPUT';
  gameId: string;
  homeTeamId: number;
  awayTeamId: number;
  seasonId: string | null;
  phase: GamePhase;
  startsAt: string;
  predictionAt: string;
  profiles: { home: TeamProfile; away: TeamProfile } | null;
  expectedPossessions: number | null;
  epistemicPriorWeight: number | null;
  means: { homeScore: number; awayScore: number; margin: number; total: number } | null;
  uncertainty: { homeScore: number; awayScore: number; margin: number; total: number; scoreCovariance: number } | null;
  homeWinProbability: number | null;
  scenarios: ScoreScenario[];
  exclusions: Array<{ gameId: string; reason: string }>;
  risks: string[];
  intelligenceSnapshotId: string | null;
}
export interface GameQuote {
  provider: 'THE_ODDS_API';
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  sportsbookKey: string;
  sportsbook: string;
  market: GameMarket;
  selection: 'HOME' | 'AWAY' | 'OVER' | 'UNDER';
  team: 'HOME' | 'AWAY' | null;
  line: number | null;
  americanOdds: number;
  updatedAt: string;
  observedAt: string;
  period: 'FULL_GAME';
}
export interface QuoteBinding {
  sourceGameId: string;
  eventId: string;
  homeTeam: string;
  awayTeam: string;
}
export interface MarketAssessment {
  status: 'PRICED' | 'UNSUPPORTED_QUOTE' | 'UNAVAILABLE_MODEL' | 'STALE_QUOTE' | 'IDENTITY_MISMATCH';
  reason: string | null;
  quote: GameQuote | null;
  winProbability: number | null;
  lossProbability: number | null;
  pushProbability: number | null;
  conditionalWinProbability: number | null;
  impliedProbability: number | null;
  fairAmericanOdds: number | null;
  evPercent: number | null;
  modelVersion: typeof GAME_MODEL_VERSION;
  validationStatus: 'UNVALIDATED';
}
export type TeamGameSource = ContextGame;