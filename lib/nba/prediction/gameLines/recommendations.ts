import { classifyPickTier, type PickTierDecision } from '../../../ai/agent/pickTiers';
import type { ResearchCandidateRecord } from '../../../ai/agent/session';
import { assessGameMarket } from './markets';
import type { GameProjection, GameQuote, MarketAssessment, QuoteBinding } from './types';
import type { GameAvailabilityAssessment } from './availability';

export type GameResearchProjection = Omit<GameProjection, 'scenarios'>;
export interface ModeledGameResearch {
  recommendationType: 'GAME';
  gameId: string;
  home: { id: number; name: string; logoUrl?: string | null };
  away: { id: number; name: string; logoUrl?: string | null };
  projection: GameResearchProjection | null;
  status: 'MODELED_NOT_BETTABLE' | 'QUOTE_AVAILABLE' | 'RESEARCH_UNAVAILABLE';
  reason: string;
  availability?: GameAvailabilityAssessment;
  quotes?: GameQuote[];
}
export interface GameRecommendation extends PickTierDecision {
  recommendationType: 'GAME';
  sport: 'nba';
  candidateId: string;
  rank: number;
  gameId: string;
  home: { id: number; name: string; logoUrl?: string | null };
  away: { id: number; name: string; logoUrl?: string | null };
  marketKey: GameQuote['market'];
  selection: GameQuote['selection'];
  selectedTeam: 'HOME' | 'AWAY' | null;
  line: number | null;
  quote: GameQuote;
  assessment: MarketAssessment;
  projection: GameResearchProjection;
  sampleSize: number;
  researchScore: number;
  dataQuality: number;
  trapRisk: number;
  trueProbability: number | null;
  evPercent: number | null;
  risks: string[];
  evidence: string[];
  availabilityVerified: boolean;
  availability?: GameAvailabilityAssessment;
}
export interface GameEvidenceReadiness {
  injuriesVerified: boolean;
  startingLineupsVerified: boolean;
  conflictsResolved: boolean;
  assessment?: GameAvailabilityAssessment;
}

export function withoutScenarios(model: GameProjection): GameResearchProjection {
  const { scenarios, ...projection } = model;
  void scenarios;
  return projection;
}

function directionalEdge(record: GameRecommendation): number | null {
  const means = record.projection.means;
  if (!means) return null;
  const quote = record.quote;
  if (quote.market === 'MONEYLINE') return quote.selection === 'HOME' ? means.margin : -means.margin;
  if (quote.market === 'SPREAD') return (quote.selection === 'HOME' ? means.margin : -means.margin) + quote.line!;
  const value = quote.market === 'TOTAL' ? means.total : quote.team === 'HOME' ? means.homeScore : means.awayScore;
  return quote.selection === 'OVER' ? value - quote.line! : quote.line! - value;
}

export function classifyGameRecommendation(record: GameRecommendation, now = new Date()): PickTierDecision {
  const update = Date.parse(record.quote.updatedAt);
  const observation = Date.parse(record.quote.observedAt);
  const priceCurrent = record.assessment.status === 'PRICED' && Number.isFinite(update) && Number.isFinite(observation)
    && update <= observation && observation <= now.getTime() && now.getTime() - update <= 3600000
    && now.getTime() < Date.parse(record.projection.startsAt);
  const probability = record.assessment.conditionalWinProbability;
  const implied = record.assessment.impliedProbability;
  const priceEdge = probability != null && implied != null ? (probability - implied) * 100 : null;
  const ev = record.assessment.evPercent;
  const availabilityCurrent = record.availability == null ? record.availabilityVerified
    : record.availabilityVerified && record.availability.impactReviewResolved && record.availability.phase.verified
      && record.availability.expiresAt != null && now.getTime() >= Date.parse(record.availability.assessedAt)
      && now.getTime() < Date.parse(record.availability.expiresAt);
  const gateInputs = {
    sampleSize: record.sampleSize, priceCurrent, priceFreshness: priceCurrent ? 'FRESH' : 'UNKNOWN', odds: record.quote.americanOdds,
    isAlternate: false, edge: directionalEdge(record), valueQualified: availabilityCurrent && record.assessment.status === 'PRICED' && ev != null && ev > 0,
    trueProbability: probability == null ? null : probability * 100, evPercent: priceCurrent ? ev : null,
    priceEdgePercent: priceCurrent ? priceEdge : null, dataQuality: record.dataQuality, trapRisk: record.trapRisk,
    researchScore: record.researchScore, eliteQualified: false, injuryContext: null, roleContext: null,
    howItLoses: record.risks,
  };
  const decision = classifyPickTier(gateInputs as ResearchCandidateRecord, 'nba');
  return !availabilityCurrent && record.availability ? { ...decision,
    tierRequirementsFailed: [...decision.tierRequirementsFailed, ...record.availability.blockers, ...(!record.availability.blockers.length ? ['Availability evidence expired at use time.'] : [])],
    tierReason: `Not recommendable: ${record.availability.blockers[0] ?? 'Availability evidence expired at use time.'}` } : decision;
}

export function buildGameRecommendation(model: GameProjection, quote: GameQuote, binding: QuoteBinding, readiness: GameEvidenceReadiness,
  now = new Date()): GameRecommendation {
  const assessment = assessGameMarket(model, quote, binding);
  const availabilityVerified = readiness.injuriesVerified && (readiness.startingLineupsVerified || readiness.assessment?.futureLineupVerified === true) && readiness.conflictsResolved
    && (readiness.assessment == null || readiness.assessment.impactReviewResolved && readiness.assessment.phase.verified);
  const sampleSize = model.profiles ? Math.min(model.profiles.home.sampleSize, model.profiles.away.sampleSize) : 0;
  const record: GameRecommendation = {
    recommendationType: 'GAME', sport: 'nba', candidateId: JSON.stringify([binding.sourceGameId, quote.eventId, quote.market,
      quote.selection, quote.team, quote.line, quote.sportsbookKey, quote.americanOdds, quote.updatedAt]), rank: 0, gameId: model.gameId,
    home: { id: model.homeTeamId, name: binding.homeTeam }, away: { id: model.awayTeamId, name: binding.awayTeam },
    marketKey: quote.market, selection: quote.selection, selectedTeam: quote.team, line: quote.line, quote, assessment,
    projection: withoutScenarios(model), sampleSize,
    researchScore: availabilityVerified && sampleSize >= 10 ? 75 : 40,
    dataQuality: availabilityVerified && sampleSize >= 10 ? 70 : 60,
    trapRisk: availabilityVerified ? 25 : 30,
    trueProbability: assessment.conditionalWinProbability == null ? null : assessment.conditionalWinProbability * 100,
    evPercent: assessment.evPercent, availabilityVerified,
    ...(readiness.assessment ? { availability: readiness.assessment } : {}),
    risks: [...model.risks, 'NBA_GAME_LINES_V1 is UNVALIDATED; no Elite or NUKE qualification is asserted.',
      ...(readiness.assessment?.blockers ?? []),
      ...(!availabilityVerified ? ['Team availability, starting lineups or material conflicts remain unresolved; not recommendable.'] : [])],
    evidence: model.profiles ? [
      `Cutoff-safe team history: home n=${model.profiles.home.sampleSize}, away n=${model.profiles.away.sampleSize}.`,
      `Observed offensive/defensive efficiency and possession proxies; ${model.phase} cohort.`,
      'All market probabilities use the same joint score distribution.',
    ].concat(readiness.assessment?.evidence ?? []) : [],
    pickTier: 'PASS', tierScore: 0, tierReason: '', tierRequirementsPassed: [], tierRequirementsFailed: [],
  };
  return { ...record, ...classifyGameRecommendation(record, now) };
}

export type NBARecommendation = ResearchCandidateRecord | GameRecommendation;
export function isGameRecommendation(value: unknown): value is GameRecommendation {
  return value != null && typeof value === 'object' && (value as { recommendationType?: string }).recommendationType === 'GAME';
}