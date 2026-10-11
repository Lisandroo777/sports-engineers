export const NFL_LEDGER_MODEL_VERSION = 'NFL_MODEL_V1_1_HARDENED' as const;
export const NFL_LEDGER_GRADING_VERSION = 'NFL_ESPN_GAMELOG_V1' as const;
export const NFL_LEDGER_SCHEMA_VERSION = 1 as const;

export type NFLLedgerGrade = 'PENDING' | 'WIN' | 'LOSS' | 'PUSH' | 'VOID' | 'UNGRADABLE';
export type NFLPregameStatus = 'PREGAME_VALID' | 'POST_KICKOFF' | 'KICKOFF_UNVERIFIED';
export type NFLRankingIntent = 'BEST' | 'MOST_LIKELY' | 'BEST_VALUE';
export type NFLResearchMode = 'STANDARD' | 'DEEP';
export type NFLSeasonPhase = 'REGULAR' | 'POSTSEASON' | 'UNKNOWN';
export type NFLMarketKey =
  | 'player_pass_yds' | 'player_pass_tds' | 'player_pass_completions' | 'player_pass_attempts' | 'player_pass_interceptions'
  | 'player_rush_yds' | 'player_rush_attempts' | 'player_rush_tds'
  | 'player_reception_yds' | 'player_receptions' | 'player_reception_tds';

export interface NFLPredictionSnapshot {
  schemaVersion: typeof NFL_LEDGER_SCHEMA_VERSION;
  predictionId: string;
  lineageFromPredictionId: string | null;
  dedupeFingerprint: string;
  origin: 'FORWARD';
  scope: 'GLOBAL';
  createdAt: string;
  presentedAt: string;
  modelVersion: typeof NFL_LEDGER_MODEL_VERSION;
  researchSessionId: string | null;
  gameId: string;
  gameKickoff: string | null;
  kickoffSource: string | null;
  playerId: number | null;
  player: string;
  teamId: number | null;
  team: string | null;
  opponent: string | null;
  market: string;
  marketKey: NFLMarketKey;
  direction: 'over' | 'under';
  line: number;
  sportsbook: string;
  americanOdds: number;
  tier: 'NUKE' | 'ELITE' | 'SHARP' | 'EDGE' | 'LEAN';
  rankingIntent: NFLRankingIntent;
  researchMode: NFLResearchMode;
  projection: number | null;
  modelProbability: number | null;
  displayedProbability: number | null;
  impliedProbability: number;
  edge: number | null;
  evPercent: number | null;
  researchScore: number | null;
  risk: number | null;
  season: number | null;
  week: number | null;
  seasonPhase: NFLSeasonPhase;
  sportFilterVersion: string | null;
  researchVersion: string | null;
  pregameStatus: NFLPregameStatus;
  pregameReason: string;
}

export interface NFLGradeRevision {
  revisionId: string;
  predictionId: string;
  revisedAt: string;
  grade: Exclude<NFLLedgerGrade, 'PENDING'>;
  actual: number | null;
  source: 'ESPN_PLAYER_GAMELOG' | 'OPERATOR_ADJUDICATION';
  sourceGameId: string | null;
  gradingVersion: string;
  sourceSignature: string;
  reason: string | null;
  supersedesRevisionId: string | null;
}

export interface NFLPredictionRecord {
  snapshot: NFLPredictionSnapshot;
  currentGrade: NFLLedgerGrade;
  currentActual: number | null;
  currentRevisionId: string | null;
}

export interface NFLLedgerRepository {
  capture(snapshot: NFLPredictionSnapshot): Promise<{ created: boolean; record: NFLPredictionRecord }>;
  get(predictionId: string): Promise<NFLPredictionRecord | null>;
  list(options?: { offset?: number; limit?: number }): Promise<NFLPredictionRecord[]>;
  appendRevision(revision: NFLGradeRevision): Promise<{ created: boolean; record: NFLPredictionRecord }>;
  revisions(predictionId: string): Promise<NFLGradeRevision[]>;
}

export interface NFLLedgerCandidateInput {
  candidateId: string;
  gameId?: string;
  playerId?: number | null;
  player: string;
  teamId?: number | null;
  team?: string | null;
  opponent?: string | null;
  market: string;
  marketKey: string;
  line: number | null;
  direction: 'over' | 'under';
  book: string | null;
  odds: number | null;
  projection: number | null;
  trueProbability: number | null;
  modelProbability?: number | null;
  edge: number | null;
  evPercent: number | null;
  researchScore: number | null;
  trapRisk: number | null;
  pickTier?: string;
  nflResearchProfile?: {
    researchMode?: string;
    sportFilterVersion?: string;
    modelVersion?: string;
    season?: number;
    week?: number;
    seasonPhase?: string;
  };
  season?: number;
  week?: number | null;
  game?: {
    id: string;
    gameTime: string;
    season?: number | null;
    week: number | null;
    seasonType?: string | null;
    completed: boolean;
  };
}
