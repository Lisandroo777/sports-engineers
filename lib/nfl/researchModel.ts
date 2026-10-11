export const NFL_SPORT_FILTER = 'NFL_FILTER' as const;
export const NFL_SPORT_FILTER_VERSION = '1.0.0' as const;
import { buildNFLSeasonContext, type NFLSeasonContext } from './seasonContext';
import type { NFLProjectionExplanation } from './opportunityProjection';
import type { NFLResearchMode } from './researchIntent';

export type NFLDataStatus = 'AVAILABLE' | 'PARTIAL_DATA' | 'UNAVAILABLE' | 'NOT_APPLICABLE';
export type NFLSourceType = 'OFFICIAL' | 'LOCAL' | 'NATIONAL' | 'SPORTSBOOK' | 'ESPN' | 'WEATHER' | 'MODEL' | 'UNKNOWN';
export type NFLIntelligenceActionability = 'HIGH' | 'MEDIUM' | 'LOW';
export type NFLIntelligenceReliability = 'CONFIRMED' | 'STRONG_SIGNAL' | 'COACH_SPEAK_UNCERTAIN' | 'SPECULATION';
export type NFLPracticeTrend = 'IMPROVING' | 'STABLE' | 'DETERIORATING' | 'UNKNOWN';
export type NFLEvidenceDirection = 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | 'MIXED';

export interface NFLSourceProvenance {
  source: string;
  sourceType: NFLSourceType;
  publishedAt: string | null;
  retrievedAt: string | null;
  affectedPlayer: string | null;
  affectedTeam: string | null;
}

export interface NFLResearchLayer<T> {
  status: NFLDataStatus;
  value: T | null;
  provenance: NFLSourceProvenance[];
  missingFields: string[];
}

export interface NFLMarketResearch {
  market: string;
  direction: 'over' | 'under';
  line: number;
  sportsbook: string;
  currentPrice: number;
  alternatePrices: Array<{ sportsbook: string; price: number; line: number }>;
  impliedProbability: number | null;
  trueProbability: number | null;
  priceEdge: number | null;
  priceFreshness: 'CURRENT' | 'STALE' | 'UNKNOWN';
}

export interface NFLRoleResearch {
  position: string | null;
  roleStatus: string | null;
  roleTrend: string | null;
  roleStability: string | null;
  roleStabilityEvidence: string[];
  snapShare: number | null;
  routeParticipation: number | null;
  targetShare: number | null;
  airYardShare: number | null;
  carryShare: number | null;
  redZoneUsage: number | null;
  goalLineUsage: number | null;
  thirdDownUsage: number | null;
  twoMinuteUsage: number | null;
  dropbacks: number | null;
  designedRushes: number | null;
  scrambles: number | null;
  teamPassVolume: number | null;
  roleEvidence: string[];
  roleConfidence: string | null;
  comparisons: { lastGame: unknown | null; last3: unknown | null; last5: unknown | null; season: unknown | null };
  positionUsage: {
    passAttempts: { lastGame: number | null; l3: number | null; l5: number | null; season: number | null };
    rushingAttempts: { lastGame: number | null; l3: number | null; l5: number | null; season: number | null };
    targets: { lastGame: number | null; l3: number | null; l5: number | null; season: number | null };
    receptions: { lastGame: number | null; l3: number | null; l5: number | null; season: number | null };
    touchdowns: { lastGame: number | null; l3: number | null; l5: number | null; season: number | null };
    touches: { lastGame: number | null; l3: number | null; l5: number | null; season: number | null };
  };
}

export interface NFLGameScriptResearch {
  environmentModel?: import('./gameEnvironment').NFLGameEnvironmentModel;
  thesis: string | null;
  expectedGameEnvironment: 'HIGH_TOTAL_MARKET' | 'LOW_TOTAL_MARKET' | 'MARKET_TOTAL_AVAILABLE' | 'UNKNOWN';
  expectedLeader: string | null;
  expectedMarginRange: { low: number | null; high: number | null; marketSpread: number | null };
  expectedPassPressure: 'HIGHER_IF_TRAILING' | 'UNKNOWN';
  expectedRushOpportunity: 'HIGHER_IF_LEADING' | 'UNKNOWN';
  expectedPossessions: number | null;
  spread: number | null;
  total: number | null;
  homeTeamTotal: number | null;
  awayTeamTotal: number | null;
  homeAway: 'HOME' | 'AWAY' | null;
  offensivePace: number | null;
  neutralPassRate: number | null;
  neutralRushRate: number | null;
  noHuddleRate: number | null;
  situationalTendencies: Record<string, number | null>;
  projectionImpact: string | null;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN' | 'UNAVAILABLE';
  evidence: string[];
  candidateEvidence: { direction: NFLEvidenceDirection; statement: string } | null;
}

export interface NFLSchemeMatchupResearch {
  matchupAnalysis?: import('./matchupEfficiency').NFLMatchupEfficiency;
  evidenceSummary: string | null;
  aggregateMetrics: Array<{ key: string; label: string; l3: { games: number; mean: number | null }; l5: { games: number; mean: number | null }; l10: { games: number; mean: number | null }; season: { games: number; mean: number | null }; trend: string }>;
  coverageRates: Record<string, number | null>;
  blitzRate: number | null;
  pressureRate: number | null;
  sackRate: number | null;
  timeToPressure: number | null;
  playerWinMechanism: string | null;
  yardsAfterCatch: number | null;
  missedTackles: number | null;
  runFrontEvidence: string | null;
  strength: 'STRONG' | 'MODERATE' | 'PARTIAL DATA' | 'UNAVAILABLE';
}

export interface NFLTrenchResearch {
  lineTrenchStatus: 'PASS_PROTECTION_ADVANTAGE' | 'NEUTRAL' | 'PASS_PROTECTION_CONCERN' | 'RUN_BLOCKING_ADVANTAGE' | 'RUN_BLOCKING_CONCERN' | 'PARTIAL_DATA' | 'UNAVAILABLE' | null;
  lineTrenchImpact: string | null;
  lineTrenchEvidence: string[];
  lineTrenchConfidence: string | null;
  injuredOffensiveLine: string[];
  injuredDefensiveFront: string[];
}

export interface NFLIntelligenceItem extends NFLSourceProvenance {
  articleUrl: string | null;
  quoteOrSummary: string;
  marketImpact: string;
  affectedMarkets: string[];
  actionability: NFLIntelligenceActionability;
  reliability: NFLIntelligenceReliability;
  direction: NFLEvidenceDirection;
  confidence: number | null;
}

export interface NFLNewsImpactSignal {
  signal: string;
  source: NFLSourceProvenance;
  affectedPlayers: string[];
  affectedMarkets: string[];
  affectedCandidateIds: string[];
  projectionImpact: string | null;
  direction: NFLEvidenceDirection;
  reEvaluationRequired: boolean;
  reEvaluatedAt: string | null;
  reEvaluationResult: 'PLAY' | 'PASS' | 'PENDING' | null;
}

export interface NFLInjuryImpact {
  player: string;
  team: string | null;
  position: string | null;
  status: string;
  relationship: 'SELF' | 'TEAMMATE' | 'OPPONENT';
  affectedMarkets: string[];
  opportunityImpact: string | null;
  source: NFLSourceProvenance | null;
}

export interface NFLPracticeEvidence {
  player: string;
  team: string | null;
  practiceDate: string;
  participation: 'DNP' | 'LIMITED' | 'FULL' | 'UNKNOWN';
  designation: string | null;
  source: NFLSourceProvenance;
}

export function classifyNFLPracticeTrend(evidence: NFLPracticeEvidence[]): NFLPracticeTrend {
  const values = evidence.filter((entry) => entry.participation !== 'UNKNOWN')
    .sort((left, right) => left.practiceDate.localeCompare(right.practiceDate))
    .map((entry) => entry.participation === 'DNP' ? 0 : entry.participation === 'LIMITED' ? 1 : 2);
  if (values.length < 2) return 'UNKNOWN';
  const improving = values.every((value, index) => index === 0 || value >= values[index - 1]);
  const deteriorating = values.every((value, index) => index === 0 || value <= values[index - 1]);
  if (improving && values.some((value, index) => index > 0 && value > values[index - 1])) return 'IMPROVING';
  if (deteriorating && values.some((value, index) => index > 0 && value < values[index - 1])) return 'DETERIORATING';
  return 'STABLE';
}

export interface NFLWeatherResearch {
  venue: string | null;
  roof: 'INDOOR' | 'OUTDOOR' | 'UNKNOWN';
  temperatureF: number | null;
  sustainedWindMph: number | null;
  gustMph: number | null;
  precipitationInches: number | null;
  fieldConditions: string | null;
  footballConsequence: string | null;
  candidateImpacts: Array<{ market: string; direction: NFLEvidenceDirection; statement: string; projectionAdjustment: null }>;
}

export interface NFLMarketIntelligence {
  openingLine: number | null;
  firstObservedLine: number | null;
  previousLine: number | null;
  currentLine: number | null;
  openingPrice: number | null;
  previousPrice: number | null;
  currentPrice: number | null;
  lineMovement: number | null;
  priceMovement: number | null;
  movementTimestamp: string | null;
  movementReason: string | null;
  valueRemains: boolean | null;
  reEvaluatedAtCurrentLine: boolean;
}

export interface NFLEvidenceItem {
  statement: string;
  source: NFLSourceProvenance | null;
  reliability: NFLIntelligenceReliability | 'MODEL_EVIDENCE';
  impact: 'LOW' | 'MEDIUM' | 'HIGH';
}

export const NFL_SCORE_WEIGHTS = {
  roleOpportunity: 20,
  matchupScheme: 15,
  expectedGameScript: 15,
  projectionVsLine: 15,
  injuryLineupImpact: 10,
  recentUnderlyingPerformance: 8,
  intelligence: 7,
  marketMovementPrice: 5,
  weather: 3,
  historicalContext: 2,
} as const;

export type NFLScoreDimension = keyof typeof NFL_SCORE_WEIGHTS;
export type NFLScoreClassification = 'ELITE' | 'STRONG' | 'LEAN' | 'PASS' | 'UNAVAILABLE';

export interface NFLScoreResult {
  score: number | null;
  classification: NFLScoreClassification;
  components: Record<NFLScoreDimension, { weight: number; componentScore: number | null; points: number | null; evidenceCoverage: number | null; confidence: 'HIGH' | 'MEDIUM' | 'LOW' | null }>;
  scoreIsOfficialQualification: false;
  productionEliteBoundary: 85;
  scoreEliteBoundary: 90;
  boundaryConflict: true;
}

export type NFLHardGateKey = 'currentPrice' | 'majorInjuryResolved' | 'roleClear' | 'requiredDataPresent'
  | 'currentLineReEvaluated' | 'footballThesisExplained' | 'sourceConflictsResolved' | 'projectionAdvantage'
  | 'priceValueRemains' | 'evidenceQuality';

export type NFLHardGates = Record<NFLHardGateKey, { passed: boolean; reason: string | null }>;

export interface NFLEvidenceConflict {
  for: NFLEvidenceItem[];
  against: NFLEvidenceItem[];
  counterCaseReviewed: boolean;
  conflictStatus: 'NONE' | 'RESOLVED' | 'UNRESOLVED';
  conflicts: Array<{ topic: string; evidence: string[]; status: 'RESOLVED' | 'UNRESOLVED'; resolutionReason: string }>;
  resolutionReason: string | null;
  highestAuthorityEvidence: string | null;
  verdict: 'PLAY' | 'PASS';
  unresolvedRisks: string[];
}

export interface NFLSourceConflictReview {
  status: 'NONE' | 'RESOLVED' | 'UNRESOLVED';
  conflicts: NFLEvidenceConflict['conflicts'];
  resolutionReason: string | null;
  highestAuthorityEvidence: string | null;
}

export function reviewNFLSourceConflicts(input: {
  intelligence: NFLIntelligenceItem[];
  injuryContext: import('./injuries').NFLInjuryContext | null;
  practiceEvidence?: NFLPracticeEvidence[];
  candidatePlayer?: string;
  candidateTeam?: string | null;
  now?: Date;
}): NFLSourceConflictReview {
  const now = input.now ?? new Date();
  const conflicts: NFLEvidenceConflict['conflicts'] = [];
  const officialEntries = input.injuryContext ? [input.injuryContext.player, ...input.injuryContext.teammateAbsences, ...input.injuryContext.opponentAbsences]
    .filter((entry) => entry.sourceStatus === 'CURRENT' && ['OUT', 'INACTIVE', 'DOUBTFUL', 'CONFIRMED_AVAILABLE', 'EXPECTED_AVAILABLE'].includes(entry.availabilityDesignation)) : [];
  const isAvailabilityClaim = (item: NFLIntelligenceItem) => /availability|available|will play|expected to play|not play|ruled out|injur|practice|DNP|active|return/i.test(`${item.quoteOrSummary} ${item.marketImpact}`);
  const playerSubject = (item: NFLIntelligenceItem) => item.affectedPlayer;
  for (const item of input.intelligence) {
    const subject = playerSubject(item);
    if (!subject || item.direction === 'NEUTRAL' || item.direction === 'MIXED' || !isAvailabilityClaim(item)) continue;
    const official = officialEntries.find((entry) => entry.player.toLowerCase() === (item.affectedPlayer ?? subject).toLowerCase());
    const officiallyOut = official != null && ['OUT', 'INACTIVE', 'DOUBTFUL'].includes(official.availabilityDesignation);
    const newsSaysAvailable = item.direction === 'POSITIVE' && item.reliability !== 'SPECULATION';
    const newsSaysUnavailable = item.direction === 'NEGATIVE';
    if (officiallyOut && newsSaysAvailable) {
      conflicts.push({ topic: `availability:${official.player}`, evidence: [item.quoteOrSummary, `${official.availabilityDesignation} on the current ESPN injury feed (${official.updatedAt ?? 'date unavailable'}).`],
        status: 'RESOLVED', resolutionReason: 'The current ESPN injury designation is treated as the highest-authority connected availability evidence over secondary reporting.' });
    } else if (official?.availabilityDesignation === 'CONFIRMED_AVAILABLE' && newsSaysUnavailable) {
      conflicts.push({ topic: `availability:${official.player}`, evidence: [item.quoteOrSummary, 'Current injury feed lists confirmed available.'],
        status: 'RESOLVED', resolutionReason: 'Current injury availability is higher-authority evidence than secondary reporting.' });
    }
  }
  const strongItems = input.intelligence.flatMap((item) => {
    const subject = playerSubject(item);
    return subject && item.direction !== 'NEUTRAL' && item.direction !== 'MIXED' && item.reliability === 'STRONG_SIGNAL'
      && Date.parse(item.publishedAt ?? '') >= now.getTime() - 72 * 60 * 60 * 1000 ? [{ item, subject }] : [];
  });
  for (let index = 0; index < strongItems.length; index += 1) {
    const first = strongItems[index];
    const second = strongItems.slice(index + 1).find(({ item, subject }) => subject.toLowerCase() === first.subject.toLowerCase()
      && item.direction !== first.item.direction && Math.abs(Date.parse(item.publishedAt ?? '') - Date.parse(first.item.publishedAt ?? '')) <= 24 * 60 * 60 * 1000);
    if (second) {
      const official = officialEntries.find((entry) => entry.player.toLowerCase() === first.subject.toLowerCase());
      const pairIsAvailability = isAvailabilityClaim(first.item) && isAvailabilityClaim(second.item);
      if (pairIsAvailability && official && ['OUT', 'INACTIVE', 'DOUBTFUL', 'CONFIRMED_AVAILABLE'].includes(official.availabilityDesignation)) continue;
      conflicts.push({ topic: `current-reporting:${first.subject}`, evidence: [first.item.quoteOrSummary, second.item.quoteOrSummary], status: 'UNRESOLVED',
        resolutionReason: 'Recent evidence of similar authority points in opposing directions.' });
    }
  }
  const latestPracticeByPlayer = new Map<string, NFLPracticeEvidence>();
  for (const practice of input.practiceEvidence ?? []) {
    const key = practice.player.toLowerCase();
    const existing = latestPracticeByPlayer.get(key);
    if (!existing || `${practice.practiceDate} ${practice.source.publishedAt ?? ''}` > `${existing.practiceDate} ${existing.source.publishedAt ?? ''}`) latestPracticeByPlayer.set(key, practice);
  }
  for (const practice of latestPracticeByPlayer.values()) {
    if (!['DNP', 'LIMITED'].includes(practice.participation)) continue;
    const practiceTime = Date.parse(practice.source.publishedAt ?? practice.practiceDate);
    const coachClaim = input.intelligence.find((item) => playerSubject(item)?.toLowerCase() === practice.player.toLowerCase()
      && item.reliability === 'COACH_SPEAK_UNCERTAIN' && item.direction === 'POSITIVE' && /no (?:injury )?limitations?|no restrictions?/i.test(item.quoteOrSummary)
      && Date.parse(item.publishedAt ?? '') >= practiceTime);
    if (coachClaim) conflicts.push({ topic: `practice:${practice.player}`, evidence: [`${practice.practiceDate}: ${practice.participation}`, coachClaim.quoteOrSummary],
      status: 'UNRESOLVED', resolutionReason: 'Objective latest practice participation conflicts with a newer uncertain coach reassurance.' });
  }
  const unique = [...new Map(conflicts.map((conflict) => [`${conflict.topic}|${conflict.status}|${conflict.evidence.join('|')}`, conflict])).values()];
  const status = unique.some((conflict) => conflict.status === 'UNRESOLVED') ? 'UNRESOLVED' : unique.length ? 'RESOLVED' : 'NONE';
  const resolved = unique.filter((conflict) => conflict.status === 'RESOLVED');
  const unresolved = unique.filter((conflict) => conflict.status === 'UNRESOLVED');
  return { status, conflicts: unique,
    resolutionReason: unresolved.length ? null : resolved.map((conflict) => conflict.resolutionReason).join(' ') || 'No relevant current evidence conflict was found.',
    highestAuthorityEvidence: resolved.map((conflict) => conflict.resolutionReason).join(' ') || null };
}

export interface NFLResearchProfile {
  gameEnvironmentModel?: import('./gameEnvironment').NFLGameEnvironmentModel;
  matchupModel?: import('./matchupEfficiency').NFLMatchupEfficiency;
  researchMode?: NFLResearchMode;
  sportFilter: typeof NFL_SPORT_FILTER;
  sportFilterVersion: typeof NFL_SPORT_FILTER_VERSION;
  market: NFLResearchLayer<NFLMarketResearch>;
  role: NFLResearchLayer<NFLRoleResearch>;
  gameScript: NFLResearchLayer<NFLGameScriptResearch>;
  schemeMatchup: NFLResearchLayer<NFLSchemeMatchupResearch>;
  trench: NFLResearchLayer<NFLTrenchResearch>;
  intelligence: NFLResearchLayer<NFLIntelligenceItem[]>;
  newsImpactSignals: NFLNewsImpactSignal[];
  injuryNetwork: NFLResearchLayer<NFLInjuryImpact[]>;
  practice: NFLResearchLayer<{ trend: NFLPracticeTrend; evidence: NFLPracticeEvidence[] }>;
  weather: NFLResearchLayer<NFLWeatherResearch>;
  marketIntelligence: NFLResearchLayer<NFLMarketIntelligence>;
  seasonContext: NFLResearchLayer<NFLSeasonContext>;
  projectionModel: NFLProjectionExplanation | null;
  evidence: NFLEvidenceConflict;
  score: NFLScoreResult;
  hardGates: NFLHardGates;
  verdict: 'PLAY' | 'PASS';
  productionEliteQualified: boolean;
}

const DIMENSIONS = Object.keys(NFL_SCORE_WEIGHTS) as NFLScoreDimension[];

export type NFLScoreRating = number | null | { rating: number | null; evidenceCoverage: number | null; confidence: 'HIGH' | 'MEDIUM' | 'LOW' | null };

export function scoreNFLResearch(ratings: Partial<Record<NFLScoreDimension, NFLScoreRating>>): NFLScoreResult {
  const components = Object.fromEntries(DIMENSIONS.map((dimension) => {
    const raw = ratings[dimension];
    const rating = raw == null ? null : typeof raw === 'number' ? Math.max(0, Math.min(100, raw))
      : raw.rating == null ? null : Math.max(0, Math.min(100, raw.rating));
    const evidenceCoverage = raw == null ? null : typeof raw === 'number' ? 100 : raw.evidenceCoverage == null ? null : Math.max(0, Math.min(100, raw.evidenceCoverage));
    const confidence = raw != null && typeof raw !== 'number' ? raw.confidence : null;
    const weight = NFL_SCORE_WEIGHTS[dimension];
    return [dimension, { weight, componentScore: rating, points: rating == null ? null : weight * rating / 100, evidenceCoverage, confidence }];
  })) as NFLScoreResult['components'];
  const complete = DIMENSIONS.every((dimension) => components[dimension].componentScore != null && components[dimension].evidenceCoverage != null && components[dimension].evidenceCoverage >= 70);
  const score = complete ? Number(DIMENSIONS.reduce((total, dimension) => total + components[dimension].points!, 0).toFixed(2)) : null;
  const classification: NFLScoreClassification = score == null ? 'UNAVAILABLE' : score >= 90 ? 'ELITE' : score >= 85 ? 'STRONG' : score >= 80 ? 'LEAN' : 'PASS';
  return { score, classification, components, scoreIsOfficialQualification: false, productionEliteBoundary: 85, scoreEliteBoundary: 90, boundaryConflict: true };
}

export function evaluateNFLHardGates(gates: NFLHardGates): { passed: boolean; failed: NFLHardGateKey[] } {
  const failed = (Object.keys(gates) as NFLHardGateKey[]).filter((key) => !gates[key].passed);
  return { passed: failed.length === 0, failed };
}

export function applyNFLHardGatesToAnalysis<T extends {
  eliteQualified: boolean;
  researchQualified: boolean;
  qualification: string;
  whyQualified: string[];
  rejectedReasons: string[];
  riskFactors: string[];
}>(analysis: T, profile: NFLResearchProfile): T {
  if (profile.productionEliteQualified || !analysis.eliteQualified) return analysis;
  const reasons = profile.evidence.unresolvedRisks;
  return { ...analysis, eliteQualified: false, researchQualified: false, qualification: 'REJECT', whyQualified: [],
    rejectedReasons: [...analysis.rejectedReasons, ...reasons], riskFactors: [...analysis.riskFactors, ...reasons] };
}

export function buildNFLEvidenceConflict(forEvidence: NFLEvidenceItem[], againstEvidence: NFLEvidenceItem[], gates: NFLHardGates, review: NFLSourceConflictReview = {
  status: 'NONE', conflicts: [], resolutionReason: 'No relevant current evidence conflict was found.', highestAuthorityEvidence: null,
}): NFLEvidenceConflict {
  const gateResult = evaluateNFLHardGates(gates);
  const conflictStatus = review.status;
  const unresolvedRisks = [
    ...gateResult.failed.map((key) => gates[key].reason ?? `${key} did not pass.`),
    ...(againstEvidence.length === 0 ? ['No documented counter-case review is available.'] : []),
    ...(forEvidence.length === 0 ? ['No sourced or model-backed evidence supports the thesis.'] : []),
  ];
  const counterCaseReviewed = againstEvidence.length > 0;
  return { for: forEvidence, against: againstEvidence, counterCaseReviewed, conflictStatus, conflicts: review.conflicts,
    resolutionReason: review.resolutionReason, highestAuthorityEvidence: review.highestAuthorityEvidence,
    verdict: gateResult.passed && forEvidence.length > 0 && counterCaseReviewed ? 'PLAY' : 'PASS', unresolvedRisks };
}

export function makeNFLResearchLayer<T>(status: NFLDataStatus, value: T | null, missingFields: string[] = [], provenance: NFLSourceProvenance[] = []): NFLResearchLayer<T> {
  return { status, value, provenance, missingFields };
}

export interface NFLResearchProfileInput {
  researchMode?: NFLResearchMode;
  candidateId?: string;
  player: string;
  position?: string | null;
  team: string | null;
  market: string;
  direction: 'over' | 'under';
  line: number;
  gameSeason?: number | null;
  gameWeek?: number | null;
  gameSeasonType?: 'REGULAR' | 'POSTSEASON' | null;
  playoffRound?: import('./types').NFLGame['playoffRound'];
  sportsbook: string;
  oddsAmerican: number;
  priceTimestamp: string | null;
  retrievedAt: string | null;
  priceCurrent: boolean;
  lineReevaluated?: boolean;
  priceFreshness: string;
  trueProbability: number | null;
  priceEdge: number | null;
  valueQualified: boolean;
  priceValueRemains?: boolean;
  existingEliteQualified: boolean;
  dataQuality: number;
  rawEdge: number | null;
  roleContext: import('./roleContext').NFLRoleContext;
  projectionModel?: NFLProjectionExplanation | null;
  roleLogs?: import('./types').NFLGameLogEntry[];
  opponentContext: import('./opponentContext').NFLOpponentContext | null;
  injuryContext: import('./injuries').NFLInjuryContext | null;
  weatherContext: import('./weather').NFLWeatherContext | null;
  marketSupport: 'full' | 'partial' | 'unsupported';
  historyGames: number | null;
  projectionAvailable: boolean;
  availabilityEligible: boolean;
  alternatePrices: Array<{ sportsbook: string | null; price: number | null; line: number }>;
  supportingReasons: string[];
  counterReasons: string[];
  intelligenceItems?: NFLIntelligenceItem[];
  intelligenceStatus?: NFLDataStatus;
  intelligenceMissingFields?: string[];
  sourceConflictReview?: NFLSourceConflictReview;
  scoreRatings?: Partial<Record<NFLScoreDimension, NFLScoreRating>>;
  marketIntelligence?: NFLMarketIntelligence;
  layerOverrides?: Partial<Pick<NFLResearchProfile, 'gameScript' | 'schemeMatchup' | 'trench' | 'intelligence' | 'practice' | 'weather' | 'marketIntelligence'>>;
  newsImpactSignals?: NFLNewsImpactSignal[];
}

export interface NFLNewsReevaluationCandidate {
  candidateId: string;
  player: string;
  market: string;
  projection: number | null;
}

export interface NFLNewsReevaluationTarget {
  signal: string;
  candidateId: string;
  player: string;
  market: string;
  projectionBefore: number | null;
  projectionAfter: null;
  status: 'PENDING';
}

export function routeNFLNewsImpact(signal: NFLNewsImpactSignal, candidates: NFLNewsReevaluationCandidate[]): NFLNewsReevaluationTarget[] {
  const players = new Set(signal.affectedPlayers.map((player) => player.toLowerCase()));
  const markets = new Set(signal.affectedMarkets);
  return candidates.filter((candidate) => players.has(candidate.player.toLowerCase()) && markets.has(candidate.market))
    .map((candidate) => ({ signal: signal.signal, candidateId: candidate.candidateId, player: candidate.player,
      market: candidate.market, projectionBefore: candidate.projection, projectionAfter: null, status: 'PENDING' }));
}

function americanImpliedProbability(odds: number): number {
  return Number(((odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100)) * 100).toFixed(1));
}

function entryProvenance(entry: import('./injuries').NFLInjuryContext['player'], retrievedAt: string | null): NFLSourceProvenance {
  return { source: 'ESPN injury report', sourceType: 'ESPN', publishedAt: entry.updatedAt, retrievedAt,
    affectedPlayer: entry.player, affectedTeam: entry.team };
}

type NFLUsageWindow = NFLRoleResearch['positionUsage']['passAttempts'];

function usageWindow(logs: import('./types').NFLGameLogEntry[], stat: string | ((entry: import('./types').NFLGameLogEntry) => number | null)): NFLUsageWindow {
  const completed = logs.filter((entry) => entry.result != null).sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
  const value = (entry: import('./types').NFLGameLogEntry) => typeof stat === 'string' ? entry.stats[stat] ?? null : stat(entry);
  const mean = (entries: import('./types').NFLGameLogEntry[]) => {
    const values = entries.map(value).filter((item): item is number => item != null && Number.isFinite(item));
    return values.length ? Number((values.reduce((sum, item) => sum + item, 0) / values.length).toFixed(2)) : null;
  };
  const last = completed.at(-1);
  const currentSeason = completed.filter((entry) => entry.historySource !== 'PREVIOUS_SEASON');
  return { lastGame: last ? value(last) : null, l3: mean(completed.slice(-3)), l5: mean(completed.slice(-5)), season: mean(currentSeason) };
}

export function buildNFLRolePositionUsage(logs: import('./types').NFLGameLogEntry[], position: string | null | undefined): NFLRoleResearch['positionUsage'] {
  const role = position?.toUpperCase();
  const unavailable: NFLUsageWindow = { lastGame: null, l3: null, l5: null, season: null };
  const touchdownKeys = role === 'QB' ? ['passingTouchdowns', 'rushingTouchdowns'] : ['rushingTouchdowns', 'receivingTouchdowns'];
  return {
    passAttempts: role === 'QB' ? usageWindow(logs, 'passingAttempts') : unavailable,
    rushingAttempts: ['QB', 'RB', 'WR', 'TE'].includes(role ?? '') ? usageWindow(logs, 'rushingAttempts') : unavailable,
    targets: ['RB', 'WR', 'TE'].includes(role ?? '') ? usageWindow(logs, 'receivingTargets') : unavailable,
    receptions: ['RB', 'WR', 'TE'].includes(role ?? '') ? usageWindow(logs, 'receptions') : unavailable,
    touchdowns: ['QB', 'RB', 'WR', 'TE'].includes(role ?? '') ? usageWindow(logs, (entry) =>
      touchdownKeys.every((key) => entry.stats[key] != null) ? touchdownKeys.reduce((sum, key) => sum + entry.stats[key], 0) : null) : unavailable,
    touches: role === 'RB' ? usageWindow(logs, (entry) => entry.stats.rushingAttempts != null && entry.stats.receptions != null
      ? entry.stats.rushingAttempts + entry.stats.receptions : null) : unavailable,
  };
}

function deriveInjuryOpportunityImpact(entry: import('./injuries').NFLInjuryContextEntry, candidatePosition: string | null | undefined, market: string): string | null {
  if (!['OUT', 'INACTIVE', 'DOUBTFUL', 'QUESTIONABLE'].includes(entry.availabilityDesignation)) return null;
  const position = entry.position?.toUpperCase() ?? '';
  const candidate = candidatePosition?.toUpperCase() ?? '';
  if (entry.affectedRole === 'OFFENSIVE_LINE') return 'Offensive-line availability can affect protection and rushing lanes; the current feed does not quantify the player-prop effect.';
  if (entry.affectedRole === 'QUARTERBACK') return 'Quarterback availability can change receiving and pass-volume opportunity; the replacement-specific effect is not quantified.';
  if (entry.affectedRole === 'BACKFIELD' && /rush|reception/.test(market)) return 'Backfield availability may redistribute carries and receiving work; shares are unavailable.';
  if (entry.affectedRole === 'RECEIVING_OPTION' && ['WR', 'TE', 'RB'].includes(candidate) && /reception|pass/.test(market)) return 'Receiving-option availability may redistribute targets; target-share impact is not available.';
  if (entry.affectedRole === 'OPPONENT_DEFENDER' && /CB|S|DB/.test(position) && /reception|pass/.test(market)) return 'Opponent defensive-back availability may affect coverage personnel; matchup effect is not quantified.';
  if (entry.affectedRole === 'OPPONENT_DEFENDER' && /LB|DE|DT|DL|NT/.test(position) && /rush/.test(market)) return 'Opponent front-seven availability may affect run defense; effect is not quantified.';
  return null;
}

export function buildNFLWeatherCandidateImpacts(weather: import('./weather').NFLWeatherContext | null, market: string, direction: 'over' | 'under'):
  Array<{ market: string; direction: NFLEvidenceDirection; statement: string; projectionAdjustment: null }> {
  if (!weather || weather.sourceStatus === 'UNKNOWN' || weather.environment === 'UNKNOWN') return [];
  if (weather.environment === 'INDOOR' || weather.sourceStatus === 'NOT_APPLICABLE') return [];
  const impacts: Array<{ market: string; direction: NFLEvidenceDirection; statement: string; projectionAdjustment: null }> = [];
  if ((weather.wind?.speed ?? 0) >= 20 && /pass_yds|pass_tds|longest_completion|reception_yds|reception_longest/.test(market)) {
    impacts.push({ market, direction: direction === 'over' ? 'NEGATIVE' : 'POSITIVE',
      statement: `Sustained wind ${weather.wind!.speed} mph is material negative evidence for deep passing efficiency; no numeric projection adjustment is calibrated.`, projectionAdjustment: null });
  }
  if ((weather.wind?.speed ?? 0) >= 20 && market === 'player_rush_attempts') {
    impacts.push({ market, direction: direction === 'over' ? 'POSITIVE' : 'NEGATIVE',
      statement: `Sustained wind ${weather.wind!.speed} mph may shift play selection toward rushing attempts; volume effect is not quantified.`, projectionAdjustment: null });
  }
  const heavyPrecipitation = /heavy rain|thunderstorm|heavy snow|violent rain/i.test(weather.conditions ?? '')
    || (weather.precipitation?.amount ?? 0) >= 0.25;
  if (heavyPrecipitation) impacts.push({ market, direction: 'MIXED',
    statement: `Forecast precipitation ${weather.precipitation!.amount} in adds footing and ball-security uncertainty; it does not independently imply an under.`, projectionAdjustment: null });
  return impacts;
}

export function buildNFLResearchProfile(input: NFLResearchProfileInput): NFLResearchProfile {
  const sportsbookSource: NFLSourceProvenance = { source: input.sportsbook, sourceType: 'SPORTSBOOK',
    publishedAt: input.priceTimestamp, retrievedAt: input.retrievedAt, affectedPlayer: input.player, affectedTeam: input.team };
  const role = input.roleContext;
  const injury = input.injuryContext;
  const opponent = input.opponentContext;
  const weather = input.weatherContext;
  const gameScriptValue = input.layerOverrides?.gameScript?.value ?? null;
  const intelligenceItems = input.intelligenceItems ?? [];
  const position = input.position?.toUpperCase() ?? null;
  const seasonContext = buildNFLSeasonContext({
    game: { season: input.gameSeason ?? null, week: input.gameWeek ?? null, seasonType: input.gameSeasonType ?? null, playoffRound: input.playoffRound ?? null },
    player: input.player, playerTeamId: input.injuryContext?.player.teamId ?? null, position,
    market: input.market as import('./oddsTypes').NFLAnalyzableMarketKey, direction: input.direction, line: input.line,
    logs: input.roleLogs ?? [], roleStatus: input.roleContext.status, roleWorkloadTrend: input.roleContext.workloadTrend,
  });
  const injuryEntries = injury ? [injury.player, ...injury.teammateAbsences, ...injury.opponentAbsences] : [];
  const injuryProvenance = injuryEntries.map((entry) => entryProvenance(entry, injury?.lastUpdated ?? null));
  const injuryImpacts: NFLInjuryImpact[] = injuryEntries.map((entry) => ({
    player: entry.player, team: entry.team, position: entry.position, status: entry.availabilityDesignation,
    relationship: entry.playerId === injury?.player.playerId ? 'SELF' : injury?.opponentAbsences.includes(entry) ? 'OPPONENT' : 'TEAMMATE',
    affectedMarkets: [input.market], opportunityImpact: deriveInjuryOpportunityImpact(entry, position, input.market),
    source: entryProvenance(entry, injury?.lastUpdated ?? null),
  }));
  const unresolvedPlayerAvailability = !injury || injury.sourceStatus.status !== 'CURRENT'
    || ['QUESTIONABLE', 'DOUBTFUL', 'UNKNOWN', 'DATA_FAILURE'].includes(injury.player.availabilityDesignation);
  const unresolvedStartingQuarterback = /pass|reception/.test(input.market)
    && injury?.teammateAbsences.some((entry) => entry.affectedRole === 'QUARTERBACK'
      && ['QUESTIONABLE', 'DOUBTFUL', 'UNKNOWN', 'DATA_FAILURE'].includes(entry.availabilityDesignation)) === true;
  const unresolvedMajorInjury = unresolvedPlayerAvailability || unresolvedStartingQuarterback;
  const marketValue: NFLMarketResearch = {
    market: input.market, direction: input.direction, line: input.line, sportsbook: input.sportsbook,
    currentPrice: input.oddsAmerican,
    alternatePrices: input.alternatePrices.flatMap((entry) => entry.sportsbook != null && entry.price != null
      ? [{ sportsbook: entry.sportsbook, price: entry.price, line: entry.line }] : []),
    impliedProbability: americanImpliedProbability(input.oddsAmerican), trueProbability: input.trueProbability,
    priceEdge: input.priceEdge, priceFreshness: input.priceCurrent ? 'CURRENT' : input.priceFreshness === 'STALE' ? 'STALE' : 'UNKNOWN',
  };
  const roleValue: NFLRoleResearch = {
    position, roleStatus: role.status, roleTrend: role.workloadTrend, roleStability: role.stability?.status ?? 'UNCERTAIN',
    roleStabilityEvidence: [...(role.stability?.evidence ?? ['Current-season role stability has not been evaluated.'])], snapShare: null, routeParticipation: null, targetShare: null,
    airYardShare: null, carryShare: null, redZoneUsage: null, goalLineUsage: null, thirdDownUsage: null, twoMinuteUsage: null,
    dropbacks: null, designedRushes: null, scrambles: null, teamPassVolume: null,
    roleEvidence: [...role.evidence], roleConfidence: role.confidence,
    comparisons: { lastGame: role.opportunity.statKey ? usageWindow(input.roleLogs ?? [], role.opportunity.statKey).lastGame : null,
      last3: role.opportunity.l3, last5: role.opportunity.l5, season: role.opportunity.season },
    positionUsage: buildNFLRolePositionUsage(input.roleLogs ?? [], position),
  };
  const layerProvenance: NFLSourceProvenance[] = [{ source: 'ESPN NFL game logs', sourceType: 'ESPN', publishedAt: null,
    retrievedAt: null, affectedPlayer: input.player, affectedTeam: input.team }];
  const currentUnavailablePlayers = new Set(injuryEntries.filter((entry) => entry.sourceStatus === 'CURRENT' && ['OUT', 'INACTIVE', 'DOUBTFUL'].includes(entry.availabilityDesignation))
    .map((entry) => entry.player.toLowerCase()));
  const sourcedFor: NFLEvidenceItem[] = intelligenceItems.filter((item) => item.direction === 'POSITIVE' && item.reliability === 'STRONG_SIGNAL'
    && !(item.affectedPlayer && currentUnavailablePlayers.has(item.affectedPlayer.toLowerCase())))
    .map((item) => ({ statement: item.quoteOrSummary, source: item, reliability: item.reliability, impact: item.actionability === 'HIGH' ? 'HIGH' : 'MEDIUM' }));
  const sourcedAgainst: NFLEvidenceItem[] = intelligenceItems.filter((item) => item.direction === 'NEGATIVE' || item.direction === 'MIXED'
    || item.reliability === 'COACH_SPEAK_UNCERTAIN' || item.reliability === 'SPECULATION')
    .map((item) => ({ statement: item.quoteOrSummary, source: item, reliability: item.reliability, impact: item.actionability === 'HIGH' ? 'HIGH' : 'MEDIUM' }));
  const weatherImpacts = buildNFLWeatherCandidateImpacts(weather, input.market, input.direction);
  const weatherProvenance: NFLSourceProvenance | null = weather ? { source: weather.sources?.forecast ?? 'ESPN venue forecast',
    sourceType: weather.sources?.forecast ? 'WEATHER' : 'ESPN', publishedAt: weather.forecastTimestamp ?? null, retrievedAt: null,
    affectedPlayer: input.player, affectedTeam: input.team } : null;
  const weatherEvidenceFor = weatherImpacts.filter((impact) => impact.direction === 'POSITIVE').map((impact) => ({
    statement: impact.statement, source: weatherProvenance,
    reliability: 'MODEL_EVIDENCE' as const, impact: 'HIGH' as const,
  }));
  const weatherEvidenceAgainst = weatherImpacts.filter((impact) => impact.direction === 'NEGATIVE' || impact.direction === 'MIXED').map((impact) => ({
    statement: impact.statement, source: weatherProvenance,
    reliability: 'MODEL_EVIDENCE' as const, impact: impact.direction === 'MIXED' ? 'MEDIUM' as const : 'HIGH' as const,
  }));
  const gameScriptEvidence: NFLEvidenceItem[] = gameScriptValue?.candidateEvidence ? [{
    statement: gameScriptValue.candidateEvidence.statement, source: null, reliability: 'MODEL_EVIDENCE', impact: 'MEDIUM',
  }] : [];
  const seasonContextEvidence: NFLEvidenceItem[] = seasonContext.notes.map((statement) => ({
    statement, source: null, reliability: 'MODEL_EVIDENCE', impact: 'MEDIUM',
  }));
  const forEvidence: NFLEvidenceItem[] = [
    ...(input.projectionModel?.gameEnvironmentModel?.evidence ?? []).map((statement) => ({ statement, source: null, reliability: 'MODEL_EVIDENCE' as const, impact: 'LOW' as const })),
    ...(input.projectionModel?.matchupModel?.evidenceFor ?? []).map((statement) => ({ statement, source: null, reliability: 'MODEL_EVIDENCE' as const, impact: 'LOW' as const })),
    ...input.supportingReasons.map((statement) => ({ statement, source: null, reliability: 'MODEL_EVIDENCE' as const, impact: 'HIGH' as const })),
    ...sourcedFor,
    ...weatherEvidenceFor,
    ...seasonContextEvidence.filter((item) => /same team and position match|measured|current-season player game logs/i.test(item.statement)),
    ...(gameScriptValue?.candidateEvidence?.direction === 'POSITIVE' ? gameScriptEvidence : []),
  ];
  const againstEvidence: NFLEvidenceItem[] = [
    ...(input.projectionModel?.gameEnvironmentModel?.counterCase ?? []).filter((statement) => !input.counterReasons.includes(statement))
      .map((statement) => ({ statement, source: null, reliability: 'MODEL_EVIDENCE' as const, impact: 'LOW' as const })),
    ...(input.projectionModel?.matchupModel?.counterCase ?? []).filter((statement) => !input.counterReasons.includes(statement))
      .map((statement) => ({ statement, source: null, reliability: 'MODEL_EVIDENCE' as const, impact: 'LOW' as const })),
    ...input.counterReasons.map((statement) => ({ statement, source: null, reliability: 'MODEL_EVIDENCE' as const, impact: 'HIGH' as const })),
    ...seasonContextEvidence.filter((item) => /uncertainty|small current-season sample|current role is (?:CHANGING|UNCERTAIN)|not established a stable role|rest, fatigue|not assumed/i.test(item.statement)),
    ...sourcedAgainst,
    ...injuryEntries.filter((entry) => entry.sourceStatus === 'CURRENT' && ['OUT', 'INACTIVE', 'DOUBTFUL'].includes(entry.availabilityDesignation))
      .map((entry) => ({ statement: `${entry.player} is listed ${entry.availabilityDesignation} in current ESPN injury evidence.`, source: entryProvenance(entry, injury?.lastUpdated ?? null),
        reliability: 'CONFIRMED' as const, impact: 'HIGH' as const })),
    ...weatherEvidenceAgainst,
    ...(gameScriptValue?.candidateEvidence?.direction === 'NEGATIVE' ? gameScriptEvidence : []),
  ];
  const practiceEvidence = input.layerOverrides?.practice?.value?.evidence ?? [];
  const sourceConflictReview = input.sourceConflictReview ?? reviewNFLSourceConflicts({ intelligence: intelligenceItems, injuryContext: injury, practiceEvidence,
    candidatePlayer: input.player, candidateTeam: input.team });
  const gameScriptEvidenceAvailable = gameScriptValue != null && (gameScriptValue.spread != null || gameScriptValue.total != null);
  const isPassingMarket = /pass|reception/.test(input.market);
  const isRushingMarket = /rush|touches/.test(input.market);
  const gameScriptDirection = gameScriptValue?.candidateEvidence?.direction ?? 'NEUTRAL';
  const relatedQuarterbackOut = isPassingMarket && injury?.teammateAbsences.some((entry) => entry.affectedRole === 'QUARTERBACK'
    && ['OUT', 'INACTIVE', 'DOUBTFUL'].includes(entry.availabilityDesignation)) === true;
  const ownLineOut = position === 'QB' && isPassingMarket && injury?.teammateAbsences.some((entry) => entry.affectedRole === 'OFFENSIVE_LINE'
    && ['OUT', 'INACTIVE', 'DOUBTFUL'].includes(entry.availabilityDesignation)) === true;
  const materialNewsNegative = intelligenceItems.some((item) => item.affectedPlayer?.toLowerCase() === input.player.toLowerCase()
    && item.direction === 'NEGATIVE' && item.actionability === 'HIGH' && ['CONFIRMED', 'STRONG_SIGNAL'].includes(item.reliability));
  const materialWeatherNegative = weatherImpacts.some((impact) => impact.direction === 'NEGATIVE' && /wind|material negative evidence/i.test(impact.statement));
  const counterCaseBlockingReason = relatedQuarterbackOut ? 'Current starting-quarterback absence leaves pass-market projections and receiver usage unresolved.'
    : ownLineOut ? 'Current offensive-line absence leaves quarterback protection unresolved.'
      : materialNewsNegative ? 'A recent high-actionability negative player report undermines the projected role.'
        : materialWeatherNegative && isPassingMarket && input.direction === 'over' ? 'Severe wind is material counter-evidence to this passing over.' : null;
  if (gameScriptValue?.candidateEvidence?.statement) {
    const item: NFLEvidenceItem = { statement: gameScriptValue.candidateEvidence.statement, source: null, reliability: 'MODEL_EVIDENCE', impact: 'MEDIUM' };
    if (gameScriptDirection === 'POSITIVE') forEvidence.push(item);
    if (gameScriptDirection === 'NEGATIVE') againstEvidence.push(item);
  }
  if (counterCaseBlockingReason) againstEvidence.push({ statement: counterCaseBlockingReason, source: null, reliability: 'MODEL_EVIDENCE', impact: 'HIGH' });
  for (const entry of injury?.teammateAbsences ?? []) {
    if (!['OUT', 'INACTIVE', 'DOUBTFUL'].includes(entry.availabilityDesignation)) continue;
    if (position === 'RB' && isRushingMarket && entry.affectedRole === 'BACKFIELD') {
      forEvidence.push({ statement: `Competing backfield player ${entry.player} is ${entry.availabilityDesignation}; workload may redistribute, but carry share is unavailable.`,
        source: entryProvenance(entry, injury?.lastUpdated ?? null), reliability: 'MODEL_EVIDENCE', impact: 'MEDIUM' });
    }
    if (['WR', 'TE'].includes(position ?? '') && isPassingMarket && entry.affectedRole === 'RECEIVING_OPTION') {
      forEvidence.push({ statement: `Competing receiving option ${entry.player} is ${entry.availabilityDesignation}; opportunity may redistribute, but target share is unavailable.`,
        source: entryProvenance(entry, injury?.lastUpdated ?? null), reliability: 'MODEL_EVIDENCE', impact: 'MEDIUM' });
    }
    if (position === 'QB' && isPassingMarket && entry.affectedRole === 'RECEIVING_OPTION') {
      againstEvidence.push({ statement: `Receiving option ${entry.player} is ${entry.availabilityDesignation}; available target personnel may change.`,
        source: entryProvenance(entry, injury?.lastUpdated ?? null), reliability: 'MODEL_EVIDENCE', impact: 'MEDIUM' });
    }
  }
  if (position === 'RB' && isRushingMarket) for (const entry of injury?.opponentAbsences ?? []) {
    if (entry.affectedRole === 'OPPONENT_DEFENDER' && /^(DE|DT|DL|NT|LB|EDGE)$/i.test(entry.position ?? '')
      && ['OUT', 'INACTIVE', 'DOUBTFUL'].includes(entry.availabilityDesignation)) {
      forEvidence.push({ statement: `Opponent front-seven player ${entry.player} is ${entry.availabilityDesignation}; run-defense impact is possible but not quantified.`,
        source: entryProvenance(entry, injury?.lastUpdated ?? null), reliability: 'MODEL_EVIDENCE', impact: 'MEDIUM' });
    }
  }
  const researchMode = input.researchMode ?? 'DEEP';
  const standard = researchMode === 'STANDARD';
  const requiredDataPresent = input.marketSupport === 'full' && input.historyGames != null
    && input.historyGames >= (standard ? 5 : 1) && input.projectionAvailable
    && opponent != null && opponent.status !== 'UNAVAILABLE' && (standard || gameScriptEvidenceAvailable);
  const footballThesisExplained = input.projectionAvailable && role.evidence.length > 0 && (standard || gameScriptEvidenceAvailable);
  const evidenceQuality = input.dataQuality >= (standard ? 70 : 90);
  const gates: NFLHardGates = {
    currentPrice: { passed: input.priceCurrent, reason: input.priceCurrent ? null : 'The sportsbook price is not current.' },
    majorInjuryResolved: { passed: input.availabilityEligible && !unresolvedMajorInjury, reason: input.availabilityEligible && !unresolvedMajorInjury ? null : 'Player or relevant injury-network status is unresolved or stale.' },
    roleClear: { passed: role.status === 'STABLE' || role.status === 'CHANGING', reason: role.status === 'STABLE' || role.status === 'CHANGING' ? null : 'Current role and opportunity are not sufficiently established.' },
    requiredDataPresent: { passed: requiredDataPresent,
      reason: requiredDataPresent ? null : standard ? 'Required market, five-game history, projection, or basic opponent evidence is missing.' : 'Required market, historical, projection, opponent, or game-market data is missing.' },
    currentLineReEvaluated: { passed: input.lineReevaluated ?? input.priceCurrent, reason: (input.lineReevaluated ?? input.priceCurrent) ? null : 'The current line has not been re-evaluated at a fresh price.' },
    footballThesisExplained: { passed: footballThesisExplained,
      reason: footballThesisExplained ? null : 'A supported role and projection thesis cannot be substantiated.' },
    sourceConflictsResolved: { passed: sourceConflictReview.status !== 'UNRESOLVED',
      reason: sourceConflictReview.status !== 'UNRESOLVED' ? null : sourceConflictReview.resolutionReason ?? 'A material current NFL evidence conflict remains unresolved.' },
    projectionAdvantage: { passed: input.valueQualified && input.rawEdge != null && Math.abs(input.rawEdge) >= 0.25 && counterCaseBlockingReason == null,
      reason: counterCaseBlockingReason ?? (input.valueQualified && input.rawEdge != null && Math.abs(input.rawEdge) >= 0.25 ? null : 'Projection advantage is missing or too small.') },
    priceValueRemains: { passed: input.priceValueRemains ?? (input.priceCurrent && input.valueQualified), reason: (input.priceValueRemains ?? (input.priceCurrent && input.valueQualified)) ? null : 'Current sportsbook pricing does not retain qualified value.' },
    evidenceQuality: { passed: evidenceQuality, reason: evidenceQuality ? null : 'Evidence quality is below the research-mode publication requirement.' },
  };
  const evidence = buildNFLEvidenceConflict(forEvidence, againstEvidence, gates, sourceConflictReview);
  const score = scoreNFLResearch(input.scoreRatings ?? {});
  const opponentMetric = (key: string) => opponent?.metrics?.find((metric) => metric.key === key) ?? null;
  const matchup = input.projectionModel?.matchupModel;
  const sackRate = matchup?.inputs.sackRate != null ? Number((matchup.inputs.sackRate * 100).toFixed(2)) : null;
  const runEfficiency = opponentMetric('yardsPerRushAttemptAllowed');
  const offensiveLineAbsences = [injury?.player, ...(injury?.teammateAbsences ?? [])].filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)
    && /^(OL|T|G|C|OT|OG|OC|LT|RT|LG|RG)$/i.test(entry!.position ?? '')
    && ['OUT', 'INACTIVE', 'DOUBTFUL', 'QUESTIONABLE'].includes(entry!.availabilityDesignation));
  const defensiveFrontAbsences = (injury?.opponentAbsences ?? []).filter((entry) => /^(DE|DT|DL|NT|LB|EDGE)$/i.test(entry.position ?? '')
    && ['OUT', 'INACTIVE', 'DOUBTFUL', 'QUESTIONABLE'].includes(entry.availabilityDesignation));
  const trenchEvidence = [
    ...(matchup?.trenchEvidence ?? []),
    ...(runEfficiency?.l10.mean == null ? [] : [`Opponent allowed ${runEfficiency.l10.mean} yards per rush over ${runEfficiency.l10.games} recorded games.`]),
    ...offensiveLineAbsences.map((entry) => `Own-team ${entry.position} ${entry.player}: ${entry.availabilityDesignation}.`),
    ...defensiveFrontAbsences.map((entry) => `Opponent ${entry.position} ${entry.player}: ${entry.availabilityDesignation}.`),
  ];
  const trenchValue: NFLTrenchResearch | null = trenchEvidence.length ? {
    lineTrenchStatus: 'PARTIAL_DATA',
    lineTrenchImpact: position === 'QB' ? 'Sack and injury evidence is available, but line-level pass protection and pressure data are not; no advantage/concern grade is assigned.'
      : position === 'RB' ? 'Rushing-efficiency and front-injury evidence is available, but blocking grades and short-yardage success are not; no advantage/concern grade is assigned.'
        : 'Relevant injury/front evidence is partial; no player-specific trench advantage is assigned.',
    lineTrenchEvidence: trenchEvidence, lineTrenchConfidence: 'LOW',
    injuredOffensiveLine: offensiveLineAbsences.map((entry) => entry.player), injuredDefensiveFront: defensiveFrontAbsences.map((entry) => entry.player),
  } : null;
  const newsImpactSignals: NFLNewsImpactSignal[] = intelligenceItems.filter((item) => item.direction !== 'NEUTRAL').map((item) => ({
    signal: item.quoteOrSummary, source: item, affectedPlayers: item.affectedPlayer ? [item.affectedPlayer] : [],
    affectedMarkets: item.affectedMarkets, affectedCandidateIds: input.candidateId ? [input.candidateId] : [],
    projectionImpact: item.marketImpact, direction: item.direction, reEvaluationRequired: item.actionability !== 'LOW',
    reEvaluatedAt: null, reEvaluationResult: item.actionability === 'LOW' ? null : 'PENDING',
  }));
  const marketIntelligence: NFLMarketIntelligence = input.marketIntelligence ?? {
    openingLine: null, firstObservedLine: null, previousLine: null, currentLine: input.line, openingPrice: null,
    previousPrice: null, currentPrice: input.oddsAmerican, lineMovement: null, priceMovement: null, movementTimestamp: input.retrievedAt,
    movementReason: 'UNKNOWN', valueRemains: input.priceCurrent ? input.valueQualified : null, reEvaluatedAtCurrentLine: input.priceCurrent,
  };
  const profile: NFLResearchProfile = {
    gameEnvironmentModel: input.projectionModel?.gameEnvironmentModel,
    matchupModel: input.projectionModel?.matchupModel,
    researchMode,
    sportFilter: NFL_SPORT_FILTER, sportFilterVersion: NFL_SPORT_FILTER_VERSION,
    market: makeNFLResearchLayer(input.priceCurrent ? 'AVAILABLE' : 'PARTIAL_DATA', marketValue, input.priceCurrent ? [] : ['fresh current price'], [sportsbookSource]),
    role: makeNFLResearchLayer(role.evidence.length ? 'PARTIAL_DATA' : 'UNAVAILABLE', roleValue, [...role.unavailableEvidence], layerProvenance),
    gameScript: input.layerOverrides?.gameScript ?? makeNFLResearchLayer<NFLGameScriptResearch>('UNAVAILABLE', null, ['spread', 'total', 'team pace', 'neutral pass/rush rate', 'situational tendencies']),
    schemeMatchup: input.layerOverrides?.schemeMatchup ?? makeNFLResearchLayer(opponent && opponent.status !== 'UNAVAILABLE' ? 'PARTIAL_DATA' : 'UNAVAILABLE', opponent ? {
      evidenceSummary: (matchup?.evidenceFor ?? opponent.evidence ?? []).join(' '), aggregateMetrics: opponent.metrics ?? [], coverageRates: {}, blitzRate: null, pressureRate: null, sackRate,
      timeToPressure: null, playerWinMechanism: matchup?.playerFit ?? null, yardsAfterCatch: null, missedTackles: null, runFrontEvidence: null, strength: 'PARTIAL DATA', matchupAnalysis: matchup,
    } : null, matchup?.missingInputs ?? opponent?.missingFields ?? ['coverage, pressure, and player-specific matchup evidence'], opponent ? [{ source: 'ESPN team box scores', sourceType: 'ESPN', publishedAt: null, retrievedAt: null, affectedPlayer: input.player, affectedTeam: opponent.opponentTeamId == null ? null : String(opponent.opponentTeamId) }] : []),
    trench: input.layerOverrides?.trench ?? makeNFLResearchLayer(trenchValue ? 'PARTIAL_DATA' : 'UNAVAILABLE', trenchValue,
      trenchValue ? ['offensive-line performance grade', 'pressure rate', 'blocking impact'] : ['offensive-line performance', 'defensive-front performance', 'trench impact']),
    intelligence: input.layerOverrides?.intelligence ?? makeNFLResearchLayer(input.intelligenceStatus ?? (intelligenceItems.length ? 'AVAILABLE' : 'UNAVAILABLE'),
      intelligenceItems, input.intelligenceMissingFields ?? (intelligenceItems.length ? [] : ['no matching current tagged NFL report'])),
    newsImpactSignals: [...(input.newsImpactSignals ?? []), ...newsImpactSignals],
    injuryNetwork: makeNFLResearchLayer(injury && injuryProvenance.length ? 'PARTIAL_DATA' : 'UNAVAILABLE', injury ? injuryImpacts : null, injury?.missingFields ?? ['current player and surrounding-player injury status'], injuryProvenance),
    practice: input.layerOverrides?.practice ?? makeNFLResearchLayer<{ trend: NFLPracticeTrend; evidence: NFLPracticeEvidence[] }>('UNAVAILABLE', null, ['dated Wednesday/Thursday/Friday practice participation']),
    weather: input.layerOverrides?.weather ?? makeNFLResearchLayer(weather?.sourceStatus === 'AVAILABLE' || weather?.sourceStatus === 'NOT_APPLICABLE' ? weather.sourceStatus === 'AVAILABLE' ? 'AVAILABLE' : 'NOT_APPLICABLE' : 'UNAVAILABLE', weather ? {
      venue: weather.venue?.name ?? null, roof: weather.environment === 'INDOOR' ? 'INDOOR' : weather.environment === 'OUTDOOR' ? 'OUTDOOR' : 'UNKNOWN',
      temperatureF: weather.temperature?.value ?? null, sustainedWindMph: weather.wind?.speed ?? null, gustMph: weather.gusts?.speed ?? null,
      precipitationInches: weather.precipitation?.amount ?? null, fieldConditions: null,
      footballConsequence: weatherImpacts.map((impact) => impact.statement).join(' ') || (weather.environment === 'INDOOR' ? 'Indoor venue; outdoor weather is not applicable.' : null),
      candidateImpacts: weatherImpacts,
    } : null, weather?.missingFields ?? ['venue weather and football impact'], weather ? [{ source: weather.sources?.forecast ?? 'ESPN venue', sourceType: weather.sources?.forecast ? 'WEATHER' : 'ESPN', publishedAt: weather.forecastTimestamp ?? null, retrievedAt: null, affectedPlayer: input.player, affectedTeam: input.team }] : []),
    marketIntelligence: input.layerOverrides?.marketIntelligence ?? makeNFLResearchLayer(marketIntelligence.openingLine != null && marketIntelligence.lineMovement != null ? 'AVAILABLE' : 'PARTIAL_DATA', marketIntelligence,
      marketIntelligence.openingLine == null ? ['bookmaker-designated opening line unavailable; only DeepSide first-observed prices are retained'] : [], [sportsbookSource]),
    seasonContext: makeNFLResearchLayer(seasonContext.phase === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'PARTIAL_DATA', seasonContext,
      seasonContext.missingData, layerProvenance),
    projectionModel: input.projectionModel ?? null,
    evidence, score, hardGates: gates, verdict: evidence.verdict,
    productionEliteQualified: input.existingEliteQualified && evidence.verdict === 'PLAY',
  };
  return profile;
}