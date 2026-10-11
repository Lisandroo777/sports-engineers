import type { NBAAnalyzableMarket } from '../market';
import type { NBAGameLogEntry } from '../types';
import type { NBAResearchContext, NBAEvidence } from '../context/types';
import type { NBAIntelligenceSnapshot, IntelligenceEvidence } from '../intelligence/types';

export type NBASeasonPhase = 'REGULAR' | 'PLAY_IN' | 'POSTSEASON' | 'PRESEASON' | 'ALL_STAR' | 'UNKNOWN';
export type NBAInjuryEvidence = 'FEED_UNAVAILABLE' | 'REPORT_MISSING' | 'REPORTED_AVAILABLE' | 'PROBABLE' | 'QUESTIONABLE' | 'DOUBTFUL' | 'OUT' | 'MINUTES_RESTRICTED' | 'UNKNOWN';
export type NBAModelGrade = 'PENDING' | 'WIN' | 'LOSS' | 'PUSH' | 'VOID' | 'UNGRADABLE';

export interface NBAObservedGame {
  log: NBAGameLogEntry;
  season: number;
  phase: NBASeasonPhase;
  source: string;
}

export interface NBAContextModelEvidence {
  contextSchemaVersion: '1';
  intelligenceSchemaVersion: '1' | null;
  adapterVersion: string;
  gameId: string;
  playerId: number;
  asOf: string;
  cutoff: string;
  injury: NBAInjuryEvidence;
  minutesRestricted: boolean;
  contextEvidence: NBAEvidence[];
  intelligenceSnapshotId: string | null;
  intelligenceEvidence: IntelligenceEvidence[];
  missing: string[];
}

export interface NBAProjectionInput {
  playerId: number;
  teamId: number;
  playerName: string;
  market: NBAAnalyzableMarket;
  targetPhase: 'REGULAR' | 'PLAY_IN' | 'POSTSEASON' | 'UNKNOWN';
  targetSeason: number | null;
  targetGameId: string;
  targetTipoff: string;
  observations: NBAObservedGame[];
  injury: NBAInjuryEvidence;
  researchContext?: NBAResearchContext | null;
  intelligenceSnapshot?: NBAIntelligenceSnapshot | null;
  line?: number | null;
  direction?: 'over' | 'under';
  americanOdds?: number | null;
  sportsbook?: string | null;
  quoteTimestamp?: string | null;
  oppositeQuote?: {
    market: NBAAnalyzableMarket;
    line: number;
    direction: 'over' | 'under';
    americanOdds: number;
    sportsbook: string;
    quoteTimestamp: string;
  } | null;
}

export interface NBAProbabilityDistribution {
  kind: 'NORMAL' | 'NEGATIVE_BINOMIAL' | 'POISSON' | 'EMPIRICAL_COMBO';
  mean: number;
  variance: number;
  sampleSize: number;
  cdf(value: number): number;
  pmf(value: number): number;
}

export interface NBAWindowRates {
  l5: number | null;
  l10: number | null;
  l20: number | null;
  season: number | null;
}

export interface NBAProjectionResult {
  modelVersion: 'NBA_MODEL_V1';
  validationStatus: 'UNVALIDATED';
  playerId: number;
  playerName: string;
  market: NBAAnalyzableMarket;
  targetPhase: Exclude<NBASeasonPhase, 'PRESEASON' | 'ALL_STAR'>;
  targetSeason: number | null;
  asOf: string;
  expectedMinutes: number | null;
  minutesUncertainty: number | null;
  minutesSampleSize: number;
  expectedStat: number | null;
  statUncertainty: number | null;
  sampleSize: number;
  availableSampleSize: number;
  reliability: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNRELIABLE';
  reasons: string[];
  historyRates: NBAWindowRates;
  opportunitiesUsed: string[];
  componentCorrelations: Record<string, number> | null;
  probabilities: { over: number; under: number; push: number } | null;
  quoteStatus: 'CURRENT' | 'STALE' | 'AFTER_PREDICTION' | 'UNAVAILABLE';
  impliedProbability: number | null;
  noVigMarketProbability: number | null;
  fairAmericanOdds: number | null;
  expectedValuePercent: number | null;
  directionalEdge: number | null;
  valueQualified: boolean;
  historicalOutlierShare: number | null;
  researchContextVersion: '1' | null;
  intelligenceSnapshotId: string | null;
  contextEvidence: NBAEvidence[];
  intelligenceEvidence: IntelligenceEvidence[];
  contextMissing: string[];
  eligibleForReview: boolean;
}
