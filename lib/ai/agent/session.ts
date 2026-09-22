import type { FinderResult } from '../../finder/engine';
import { analyzePickCandidate, finderResultToEliteCandidate, type EliteResearchAnalysis } from '../eliteResearchFilter';
import { buildDeepResearchCard, type DeepResearchCard } from '../../finder/deepResearchCard';
import { ELITE_THRESHOLDS } from '../eliteResearchFilter';
import { buildEvidenceBoard } from '../../finder/evidenceBoard';
import type { CrossBookThresholdResult } from '../../finder/crossBookThreshold';
import type { MarketMovementSignal } from '../../finder/marketMovement';

/** Generic, sport-agnostic outlier-dependence summary (MLB/NFL/NBA all shape their own module to this). */
export interface GenericOutlierAnalysis {
  applicability: 'APPLICABLE' | 'OUTLIER_ANALYSIS_NOT_APPLICABLE';
  available: boolean;
  sampleGames: number;
  explosiveDependencePercent: number | null;
}

/** NFL-only role/workload verdict (see lib/nfl/roleContext.ts). Null for sports without one. */
export interface GenericRoleContext {
  requirement: string;
  status: string;
  confidence: string;
  workloadTrend: string;
  reasons: string[];
  evidence?: string[];
  unavailableEvidence?: string[];
}

/** NBA-only opponent defensive/pace context (see lib/nba/opponentContext.ts). Null for sports without one. */
export interface GenericOpponentContext {
  status: string;
  availableMetrics: string[];
  unavailableMetrics: string[];
  evidence: string[];
  sampleSize?: number;
  trend?: string;
  sourceStatus?: unknown;
  metrics?: unknown[];
}

/** One fully researched candidate, flattened for storage and for follow-up tool answers. */
export interface ResearchCandidateRecord {
  candidateId: string;
  /** Position when all researched candidates are ordered by researchScore descending (1 = best). */
  rank: number;
  playerId: number | null;
  teamId: number | null;
  player: string;
  team: string | null;
  opponent: string | null;
  market: string;
  marketKey: string;
  line: number | null;
  direction: 'over' | 'under';
  book: string | null;
  odds: number | null;
  availableBooks: number;
  projection: number | null;
  projectionUncertainty: number | null;
  /** Signed distance the projection clears the line by (rawEdge from the Elite Filter). */
  edge: number | null;
  l5Rate: number | null;
  l10Rate: number | null;
  l20Rate: number | null;
  seasonRate: number | null;
  researchScore: number;
  signalAgreement: number;
  /** Denominator for signalAgreement — report as signalAgreement/signalsAvailable, never rescaled. */
  signalsAvailable: number;
  evidenceCoverage: number;
  priceFreshness: string;
  trueProbability: number | null;
  evPercent: number | null;
  isAlternate: boolean;
  dataQuality: number;
  trapRisk: number;
  qualification: string;
  eliteQualified: boolean;
  rejectionReasons: string[];
  /** Deep research: confidence grade, failure modes, alternate-line recommendation, evidence board. */
  grade: DeepResearchCard['grade'];
  priceGrade: DeepResearchCard['priceGrade'];
  playerEdgePercent: number | null;
  priceEdgePercent: number | null;
  breakEvenProbability: number | null;
  projectedRange: DeepResearchCard['projectedRange'];
  bestAlternateLine: DeepResearchCard['bestAlternateLine'];
  howItLoses: string[];
  evidenceBoard: DeepResearchCard['evidenceBoard'];
  outlierDependencePercent: number | null;
  /** Real ESPN position (NBA) or NFL role group derived from the market key (qb/rb/wr_te/k/def). Null when unknown. */
  position: string | null;
  /** P(clears line) from the modelled distribution alone, before historical calibration. */
  modelProbability: number | null;
  /** Recency-weighted observed hit rate — supporting/calibration evidence only, never the probability itself. */
  historicalHitRate: number | null;
  sampleSize?: number | null;
  average?: number | null;
  median?: number | null;
  standardDeviation?: number | null;
  homeHitRate?: number | null;
  awayHitRate?: number | null;
  /** SportProjection reliability grade (HIGH/MEDIUM/LOW/UNRELIABLE) for the sports that have one. */
  projectionReliability: string | null;
  /** Price is LIVE/FRESH — renamed/split from the old priceQualified (freshness-only). */
  priceCurrent: boolean;
  /** Valid probability + break-even + EV/edge all present and EV clears the minimum. */
  valueQualified: boolean;
  crossBookThreshold: CrossBookThresholdResult | null;
  marketMovement: MarketMovementSignal | null;
  outlierAnalysis: GenericOutlierAnalysis | null;
  roleContext: GenericRoleContext | null;
  opponentContext: GenericOpponentContext | null;
  injuryContext: unknown | null;
  weatherContext: unknown | null;
}

export interface ResearchSessionToolMeta {
  gamesFound: number;
  gamesScheduled: number;
  propsFound: number;
  booksFound: number;
  candidatesFound: number;
  eliteFound: number;
  cached: boolean;
  dataFreshnessSeconds: number | null;
  budgetLimited: boolean;
}

/** The AI's persistent memory of the last successful research run — the source of truth for follow-ups. */
export interface ResearchSession {
  sport: string;
  date: string;
  /** The user request that produced this session, so follow-ups can reference what was originally asked. */
  queryIntent: string;
  generatedAt: string;
  toolMeta: ResearchSessionToolMeta;
  /** Every researched candidate (elite and non-elite), ranked by researchScore descending. */
  candidates: ResearchCandidateRecord[];
}

function toRecord(result: FinderResult, analysis: EliteResearchAnalysis, rank: number): ResearchCandidateRecord {
  const deep = buildDeepResearchCard(result, analysis);
  return {
    candidateId: result.id,
    rank,
    playerId: result.playerId,
    teamId: result.teamId,
    player: result.player,
    team: result.teamName,
    opponent: result.opponentName,
    market: result.marketLabel,
    marketKey: result.marketKey,
    line: result.line,
    direction: result.side,
    book: result.bestBook?.sportsbookName ?? null,
    odds: result.bestBook?.odds ?? null,
    availableBooks: result.availableBooks,
    projection: result.projection,
    projectionUncertainty: result.projectionUncertainty,
    edge: analysis.rawEdge,
    l5Rate: result.historical.l5Rate,
    l10Rate: result.historical.l10Rate,
    l20Rate: result.historical.l20Rate,
    seasonRate: result.historical.seasonRate,
    researchScore: analysis.researchScore,
    signalAgreement: analysis.signalAgreement,
    signalsAvailable: analysis.signalsAvailable,
    evidenceCoverage: analysis.evidenceCoverage,
    priceFreshness: analysis.priceFreshness,
    trueProbability: analysis.trueProbability,
    evPercent: analysis.evPercent,
    isAlternate: analysis.isAlternate,
    dataQuality: analysis.dataQuality,
    trapRisk: analysis.trapRisk,
    qualification: analysis.qualification,
    eliteQualified: analysis.eliteQualified,
    rejectionReasons: analysis.rejectedReasons,
    grade: deep.grade,
    priceGrade: deep.priceGrade,
    playerEdgePercent: deep.playerEdgePercent,
    priceEdgePercent: deep.priceEdgePercent,
    breakEvenProbability: deep.breakEvenProbability,
    projectedRange: deep.projectedRange,
    bestAlternateLine: deep.bestAlternateLine,
    howItLoses: deep.howItLoses,
    evidenceBoard: deep.evidenceBoard,
    outlierDependencePercent: result.outlierDependency.explosiveDependencePercent,
    position: null,
    modelProbability: analysis.modelProbability,
    historicalHitRate: analysis.historicalHitRatePercent,
    // MLB does not use the shared SportProjection contract, so no reliability grade exists yet.
    projectionReliability: null,
    priceCurrent: analysis.priceCurrent,
    valueQualified: analysis.valueQualified,
    crossBookThreshold: result.crossBookThreshold,
    marketMovement: result.marketMovement,
    outlierAnalysis: {
      applicability: 'APPLICABLE',
      available: result.outlierDependency.available,
      sampleGames: result.outlierDependency.sampleGames,
      explosiveDependencePercent: result.outlierDependency.explosiveDependencePercent,
    },
    roleContext: null,
    opponentContext: null,
    injuryContext: null,
    weatherContext: null,
  };
}

/** Builds a fresh structured session from real Finder results. Never invents a field — everything traces to a FinderResult. */
export function buildResearchSession(params: {
  sport: string;
  date: string;
  queryIntent: string;
  results: FinderResult[];
  toolMeta: Omit<ResearchSessionToolMeta, 'eliteFound'>;
}): ResearchSession {
  const analysed = params.results
    .map((result) => ({ result, analysis: analyzePickCandidate(finderResultToEliteCandidate(result)) }))
    .sort((a, b) => b.analysis.researchScore - a.analysis.researchScore);

  return {
    sport: params.sport,
    date: params.date,
    queryIntent: params.queryIntent,
    generatedAt: new Date().toISOString(),
    toolMeta: { ...params.toolMeta, eliteFound: analysed.filter((entry) => entry.analysis.eliteQualified).length },
    candidates: analysed.map(({ result, analysis }, index) => toRecord(result, analysis, index + 1)),
  };
}

/** Non-elite candidates ordered by their total deficit against the existing Elite gates. */
export function getClosestMisses(session: ResearchSession, count: number): ResearchCandidateRecord[] {
  const gateDeficit = (candidate: ResearchCandidateRecord) => {
    const agreementRatio = candidate.signalsAvailable > 0 ? candidate.signalAgreement / candidate.signalsAvailable : 0;
    return Math.max(0, ELITE_THRESHOLDS.researchScore - candidate.researchScore)
      + Math.max(0, ELITE_THRESHOLDS.dataQuality - candidate.dataQuality)
      + Math.max(0, candidate.trapRisk - ELITE_THRESHOLDS.trapRisk)
      + Math.max(0, ELITE_THRESHOLDS.minSignalsAvailable - candidate.signalsAvailable) * 10
      + Math.max(0, ELITE_THRESHOLDS.minAgreementRatio - agreementRatio) * 100
      + (candidate.valueQualified ? 0 : 10)
      + (candidate.priceCurrent ? 0 : 5);
  };
  return session.candidates
    .filter((candidate) => !candidate.eliteQualified)
    .sort((a, b) => gateDeficit(a) - gateDeficit(b) || b.researchScore - a.researchScore || a.trapRisk - b.trapRisk)
    .slice(0, count);
}

export function getEliteCandidates(session: ResearchSession): ResearchCandidateRecord[] {
  return session.candidates.filter((candidate) => candidate.eliteQualified);
}

function priceGradeFromEv(evPercent: number | null): ResearchCandidateRecord['priceGrade'] {
  if (evPercent == null) return 'unavailable';
  if (evPercent >= 5) return 'A';
  if (evPercent >= 0) return 'B';
  if (evPercent >= -5) return 'C';
  return 'D';
}

/**
 * One pre-researched candidate for sports that don't yet have the MLB-only signal modules
 * (marketMovement, outlierDependency, volumeEfficiency, alternateLineOptimizer, crossBookThreshold)
 * that FinderResult/buildDeepResearchCard depend on. Every field here traces to a real value already
 * computed by that sport's Finder engine (NFLCandidate/NBACandidate) plus its EliteResearchAnalysis —
 * nothing is invented to fill an MLB-shaped gap.
 */
export interface GenericResearchCandidate {
  candidateId: string;
  playerId?: number | null;
  teamId?: number | null;
  player: string;
  team: string | null;
  opponent: string | null;
  marketLabel: string;
  marketKey: string;
  line: number | null;
  direction: 'over' | 'under';
  book: string | null;
  odds: number | null;
  projection: number | null;
  projectionUncertainty: number | null;
  l5Rate: number | null;
  l10Rate: number | null;
  l20Rate: number | null;
  seasonRate: number | null;
  sampleSize?: number | null;
  average?: number | null;
  median?: number | null;
  standardDeviation?: number | null;
  homeHitRate?: number | null;
  awayHitRate?: number | null;
  analysis: EliteResearchAnalysis;
  sport?: string;
  matchupAvailable?: boolean;
  roleKnown?: boolean;
  injuryKnown?: boolean;
  outlierDependencePercent?: number | null;
  crossBookDiscrepancy?: boolean | null;
  marketMovementAvailable?: boolean;
  /** Real, computed failure-mode bullets from that sport's own How-It-Loses builder. */
  howItLoses?: string[];
  bestAlternateLine?: ResearchCandidateRecord['bestAlternateLine'];
  position?: string | null;
  projectionReliability?: string | null;
  crossBookThreshold?: CrossBookThresholdResult | null;
  marketMovement?: MarketMovementSignal | null;
  outlierAnalysis?: GenericOutlierAnalysis | null;
  roleContext?: GenericRoleContext | null;
  opponentContext?: GenericOpponentContext | null;
  injuryContext?: unknown | null;
  weatherContext?: unknown | null;
}

function toGenericRecord(candidate: GenericResearchCandidate, rank: number): ResearchCandidateRecord {
  const { analysis } = candidate;
  const breakEvenProbability = analysis.breakEvenProbability != null ? Number((analysis.breakEvenProbability * 100).toFixed(1)) : null;
  const playerEdgePercent = candidate.l10Rate != null && breakEvenProbability != null
    ? Number((candidate.l10Rate - breakEvenProbability).toFixed(1))
    : null;
  const evidenceBoard = buildEvidenceBoard({
    side: candidate.direction,
    rawEdge: analysis.rawEdge,
    l10Rate: candidate.l10Rate,
    seasonRate: candidate.seasonRate,
    matchupAvailable: candidate.matchupAvailable ?? false,
    roleKnown: candidate.roleKnown ?? false,
    sport: candidate.sport ?? 'unknown',
    injuryKnown: candidate.injuryKnown ?? false,
    outlierDependencePercent: candidate.outlierDependencePercent ?? null,
    priceValueAvailable: analysis.evPercent != null,
    priceValueDetail: analysis.evPercent != null ? `${analysis.evPercent.toFixed(1)}% EV at the best current price` : undefined,
    crossBookDiscrepancy: candidate.crossBookDiscrepancy ?? null,
    marketMovementAvailable: candidate.marketMovementAvailable ?? false,
  });
  return {
    candidateId: candidate.candidateId,
    rank,
    playerId: candidate.playerId ?? null,
    teamId: candidate.teamId ?? null,
    player: candidate.player,
    team: candidate.team,
    opponent: candidate.opponent,
    market: candidate.marketLabel,
    marketKey: candidate.marketKey,
    line: candidate.line,
    direction: candidate.direction,
    book: candidate.book,
    odds: candidate.odds,
    availableBooks: candidate.odds != null ? 1 : 0,
    projection: candidate.projection,
    projectionUncertainty: candidate.projectionUncertainty,
    edge: analysis.rawEdge,
    l5Rate: candidate.l5Rate,
    l10Rate: candidate.l10Rate,
    l20Rate: candidate.l20Rate,
    seasonRate: candidate.seasonRate,
    researchScore: analysis.researchScore,
    signalAgreement: analysis.signalAgreement,
    signalsAvailable: analysis.signalsAvailable,
    evidenceCoverage: analysis.evidenceCoverage,
    priceFreshness: analysis.priceFreshness,
    trueProbability: analysis.trueProbability,
    evPercent: analysis.evPercent,
    isAlternate: analysis.isAlternate,
    dataQuality: analysis.dataQuality,
    trapRisk: analysis.trapRisk,
    qualification: analysis.qualification,
    eliteQualified: analysis.eliteQualified,
    rejectionReasons: analysis.rejectedReasons,
    // The MLB-only deep-research signal modules (outlier dependence, alternate-line optimizer,
    // market movement, etc.) are not connected for this sport yet. These fields report that
    // honestly as "unavailable" rather than a fabricated grade.
    grade: analysis.eliteQualified ? 'A' : analysis.researchScore >= 75 ? 'B' : analysis.researchScore >= 60 ? 'C' : analysis.researchScore >= 40 ? 'D' : 'F',
    priceGrade: priceGradeFromEv(analysis.evPercent),
    playerEdgePercent,
    priceEdgePercent: analysis.priceEdgePercent,
    breakEvenProbability,
    projectedRange: null,
    bestAlternateLine: candidate.bestAlternateLine ?? null,
    howItLoses: candidate.howItLoses?.length ? candidate.howItLoses : analysis.trapReasons,
    evidenceBoard,
    outlierDependencePercent: candidate.outlierDependencePercent ?? null,
    position: candidate.position ?? null,
    modelProbability: analysis.modelProbability,
    historicalHitRate: analysis.historicalHitRatePercent,
    sampleSize: candidate.sampleSize ?? null,
    average: candidate.average ?? null,
    median: candidate.median ?? null,
    standardDeviation: candidate.standardDeviation ?? null,
    homeHitRate: candidate.homeHitRate ?? null,
    awayHitRate: candidate.awayHitRate ?? null,
    projectionReliability: candidate.projectionReliability ?? null,
    priceCurrent: analysis.priceCurrent,
    valueQualified: analysis.valueQualified,
    crossBookThreshold: candidate.crossBookThreshold ?? null,
    marketMovement: candidate.marketMovement ?? null,
    outlierAnalysis: candidate.outlierAnalysis ?? null,
    roleContext: candidate.roleContext ?? null,
    opponentContext: candidate.opponentContext ?? null,
    injuryContext: candidate.injuryContext ?? null,
    weatherContext: candidate.weatherContext ?? null,
  };
}

/**
 * Builds a ResearchSession from a sport's own already-researched candidate pool (NFL/NBA), rather
 * than from FinderResult. Used only by sports without the MLB-only deep-research signal modules.
 */
export function buildResearchSessionFromCandidates(params: {
  sport: string;
  date: string;
  queryIntent: string;
  candidates: GenericResearchCandidate[];
  toolMeta: Omit<ResearchSessionToolMeta, 'eliteFound'>;
}): ResearchSession {
  const ranked = [...params.candidates].sort((a, b) => b.analysis.researchScore - a.analysis.researchScore);
  return {
    sport: params.sport,
    date: params.date,
    queryIntent: params.queryIntent,
    generatedAt: new Date().toISOString(),
    toolMeta: { ...params.toolMeta, eliteFound: ranked.filter((c) => c.analysis.eliteQualified).length },
    candidates: ranked.map((candidate, index) => toGenericRecord(candidate, index + 1)),
  };
}
