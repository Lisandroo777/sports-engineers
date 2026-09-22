import type { FinderResult } from '../finder/engine';
import type { PropResearchItem } from '../../app/research/mockData';
import { getSportResearchAdapter, type MarketSupport, type SupportedSport } from './sportResearchAdapters';
import { americanToDecimalOdds, americanToImpliedProbability } from '../odds/math';
import { modelProbability, calibrateProbability, type DistributionUsed, type MarketFamily } from './probabilityModel';

export const ELITE_RESEARCH_WEIGHTS = {
  projectionVsLine: 0.24,
  opponentMatchup: 0.14,
  usageOpportunity: 0.12,
  longTermBaseline: 0.12,
  recentForm: 0.12,
  expectedRole: 0.09,
  projectionAgreement: 0.07,
  opponentPersonnel: 0.07,
  gameContext: 0.07,
  marketConfirmation: 0.06,
  dataReliability: 0.03,
} as const;

/** Documented, centralised Elite gates. Changing a number here changes qualification everywhere. */
export const ELITE_THRESHOLDS = {
  researchScore: 85,
  /** Distinct, non-correlated signals that must actually be available before agreement means anything. */
  minSignalsAvailable: 4,
  /** Share of AVAILABLE signals that must agree (replaces the old rescaled "x/8"). */
  minAgreementRatio: 0.75,
  dataQuality: 90,
  trapRisk: 25,
  minSampleSize: 10,
  minAbsEdge: 0.25,
  /** An Elite pick must not be priced to lose against our own probability estimate. */
  minEvPercent: 0,
} as const;

export type EliteQualificationLevel = 'ELITE' | 'STRONG' | 'WATCH' | 'REJECT';

/**
 * UNSUPPORTED = DeepSide has no connected data source for this signal. It is NEUTRAL: it never counts
 * as agreement, never counts as risk, and never reduces data quality — we cannot penalise a candidate
 * for evidence the product has never collected.
 * MISSING = the signal is normally available for this sport/market but is absent for this candidate.
 */
export type SignalAvailability = 'AVAILABLE' | 'UNSUPPORTED' | 'MISSING';

/** How current the sportsbook price is. Kept strictly separate from research-data validity. */
export type PriceFreshness = 'LIVE' | 'FRESH' | 'STALE' | 'EXPIRED' | 'UNKNOWN';

export interface EliteCandidateInput {
  candidateId: string;
  sport: SupportedSport;
  playerId: number | null;
  player: string;
  market: string;
  line: number | null;
  direction: 'over' | 'under';
  /** True when this is a shifted alternate line rather than the book's main market. */
  isAlternate: boolean;
  projection: number | null;
  projectionUncertainty: number | null;
  historicalRates: Array<number | null>;
  sampleSize: number | null;
  /** Best available American price for this exact side, used for break-even/EV. */
  oddsAmerican: number | null;
  /** Vig-removed two-way consensus probability from the market, when the book posted both sides. */
  marketFairProbability: number | null;
  matchupAvailable: boolean;
  usageAvailable: boolean;
  roleKnown: boolean;
  gameContextAvailable: boolean;
  opponentPersonnelAvailable: boolean;
  marketConfirmationAvailable: boolean;
  statusKnown: boolean;
  lastUpdatedAt: string | null;
  requiredMarketSupported: boolean;
  marketSupport?: MarketSupport;
  /** Signals with no connected data source for this sport — treated as neutral, never as risk. */
  unsupportedSignals?: Array<keyof typeof ELITE_RESEARCH_WEIGHTS>;
}

export interface SignalBreakdown {
  key: string;
  availability: SignalAvailability;
  value: number | null;
  agrees: boolean;
}

export interface TrapComponent {
  reason: string;
  points: number;
}

export interface EliteResearchAnalysis {
  candidateId: string;
  sport: SupportedSport;
  player: string;
  market: string;
  line: number | null;
  direction: 'over' | 'under';
  isAlternate: boolean;
  projection: number | null;
  /** Signed: positive supports the candidate, negative opposes it. */
  rawEdge: number | null;
  normalizedEdge: number | null;
  researchScore: number;
  /** Quality of the evidence that IS present, 0-100, before coverage scaling. */
  evidenceStrength: number;
  /** Share of supportable evidence actually present, 0-100. Low coverage caps researchScore. */
  evidenceCoverage: number;
  /** Count of AVAILABLE signals that agree. Report as signalAgreement/signalsAvailable. */
  signalAgreement: number;
  signalsAvailable: number;
  signalsDisagreeing: number;
  signalsUnavailable: number;
  agreementRatio: number | null;
  signals: SignalBreakdown[];
  trapRisk: number;
  trapComponents: TrapComponent[];
  dataQuality: number;
  priceFreshness: PriceFreshness;
  /** Only LIVE/FRESH prices count as current — renamed from priceQualified for clarity. */
  priceCurrent: boolean;
  /** True probability, break-even and EV/edge are all valid AND EV clears the minimum — independent of price age. */
  valueQualified: boolean;
  breakEvenProbability: number | null;
  /** P(clears line) from the modelled distribution alone — no historical blending. */
  modelProbability: number | null;
  /** Observed hit rate, supporting evidence only. Never returned as trueProbability. */
  historicalHitRatePercent: number | null;
  /** Model probability after bounded historical calibration. This is DeepSide's true probability. */
  trueProbability: number | null;
  trueProbabilityBasis: string | null;
  distributionUsed: DistributionUsed | null;
  marketFamily: MarketFamily | null;
  zSeparation: number | null;
  /** |model - historical|; large values indicate projection bias or instability. */
  probabilityDivergence: number | null;
  /** Null unless the price is LIVE/FRESH — a stale price can never imply current value. */
  priceEdgePercent: number | null;
  evPercent: number | null;
  rawHitRate: number | null;
  contextAdjustedHitRate: number | null;
  qualification: EliteQualificationLevel;
  eliteQualified: boolean;
  /** Passes all research gates but the price is too old to assert current EV. */
  researchQualified: boolean;
  rejectedReasons: string[];
  trapReasons: string[];
  whyQualified: string[];
  riskFactors: string[];
  adapter: string;
  marketSupport: MarketSupport;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function classifyPriceFreshness(lastUpdatedAt: string | null): PriceFreshness {
  if (!lastUpdatedAt) return 'UNKNOWN';
  const age = Date.now() - new Date(lastUpdatedAt).getTime();
  if (!Number.isFinite(age) || age < 0) return 'UNKNOWN';
  if (age <= 5 * 60 * 1000) return 'LIVE';
  if (age <= 60 * 60 * 1000) return 'FRESH';
  if (age <= 12 * 60 * 60 * 1000) return 'STALE';
  return 'EXPIRED';
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/**
 * SIGNED projection score. edge > 0 supports the candidate, edge < 0 opposes it.
 * 50 = no edge; a wrong-way projection scores BELOW 50 and can reach 0.
 */
export function scoreProjection(edge: number | null, uncertainty: number | null) {
  if (edge == null) return null;
  const z = uncertainty != null && uncertainty > 0 ? edge / uncertainty : edge * 2;
  return clamp(50 + z * 25);
}

/**
 * Recency-weighted observed hit rate for this exact line. This is SUPPORTING EVIDENCE ONLY —
 * it is never returned as trueProbability. See probabilityModel.ts for the actual model.
 *   pHat = Σ(w_i · rate_i) / Σ(w_i),  w = [L5 .20, L10 .35, L20 .30, season .15]
 */
export function historicalHitRate(params: {
  historicalRates: Array<number | null>;
  sampleSize: number | null;
}): number | null {
  const { historicalRates, sampleSize } = params;
  if (sampleSize == null || sampleSize < ELITE_THRESHOLDS.minSampleSize) return null;
  const weights = [0.2, 0.35, 0.3, 0.15];
  let weighted = 0;
  let weightTotal = 0;
  historicalRates.forEach((rate, index) => {
    if (rate == null || !Number.isFinite(rate) || index >= weights.length) return;
    weighted += (rate / 100) * weights[index];
    weightTotal += weights[index];
  });
  if (weightTotal === 0) return null;
  return weighted / weightTotal;
}

/** One deterministic gate for every AI-generated pick. No provider calls, guesses, or fallback stats. */
export function analyzePickCandidate(input: EliteCandidateInput): EliteResearchAnalysis {
  const adapter = getSportResearchAdapter(input.sport);
  const rejectedReasons: string[] = [];
  const trapComponents: TrapComponent[] = [];
  const unsupported = new Set(input.unsupportedSignals ?? []);

  const rates = input.historicalRates.filter((value): value is number => value != null && value >= 0);
  const rawHitRate = rates.length ? rates[rates.length - 1] : null;
  const baseline = mean(rates);
  const hasHistory = rates.length > 0;

  const rawEdge = input.projection != null && input.line != null
    ? input.direction === 'over' ? input.projection - input.line : input.line - input.projection
    : null;
  const normalizedEdge = rawEdge != null && input.projectionUncertainty != null && input.projectionUncertainty > 0
    ? rawEdge / input.projectionUncertainty
    : null;

  // ── probability: modelled distribution first, historical only as bounded calibration ──
  const priceFreshness = classifyPriceFreshness(input.lastUpdatedAt);
  const priceCurrent = priceFreshness === 'LIVE' || priceFreshness === 'FRESH';
  const breakEvenProbability = input.oddsAmerican != null ? americanToImpliedProbability(input.oddsAmerican) : null;

  const model = modelProbability({
    marketKey: input.market,
    line: input.line,
    direction: input.direction,
    projection: input.projection,
    projectionUncertainty: input.projectionUncertainty,
    sampleSize: input.sampleSize,
  });
  const observedHitRate = historicalHitRate({ historicalRates: input.historicalRates, sampleSize: input.sampleSize });
  const calibrated = model ? calibrateProbability({
    modelProbability: model.probability,
    historicalHitRate: observedHitRate,
    sampleSize: input.sampleSize,
  }) : null;
  // Fails closed: no defensible distribution -> no probability, no EV.
  const trueProbability = calibrated?.calibratedProbability ?? null;

  const decimal = input.oddsAmerican != null ? americanToDecimalOdds(input.oddsAmerican) : null;
  const rawEv = trueProbability != null && decimal != null ? (trueProbability * decimal - 1) * 100 : null;
  const rawPriceEdge = trueProbability != null && breakEvenProbability != null
    ? (trueProbability - breakEvenProbability) * 100
    : null;
  // A stale price cannot support a CURRENT value claim, so current EV/edge are suppressed entirely
  // rather than shown with a caveat that a reader could miss.
  const evPercent = priceCurrent ? rawEv : null;
  const priceEdgePercent = priceCurrent ? rawPriceEdge : null;

  // ── hard rejections: only things that make the candidate impossible to evaluate or clearly wrong ──
  // Stale prices are NOT rejected here; they are handled once via priceCurrent.
  if (input.line == null) rejectedReasons.push('Missing sportsbook line');
  if (input.projection == null) rejectedReasons.push('Projection unavailable');
  if (!adapter) rejectedReasons.push('Sport research adapter unavailable');
  if (!input.requiredMarketSupported || input.marketSupport === 'UNAVAILABLE') rejectedReasons.push('Market/stat mapping unsupported');
  if (input.marketSupport === 'PARTIAL') rejectedReasons.push('Market/stat mapping is only partial');
  if (input.playerId == null) rejectedReasons.push('Player identity unavailable');
  if (input.sampleSize == null || input.sampleSize < 5) rejectedReasons.push('Insufficient sample size');
  if (rawEdge != null && rawEdge <= 0) rejectedReasons.push('Projection does not clear the line');
  if (rawEdge != null && rawEdge > 0 && rawEdge < ELITE_THRESHOLDS.minAbsEdge) rejectedReasons.push('Projection too close to line');

  // ── evidence components; UNSUPPORTED ones are excluded from BOTH numerator and denominator ──
  type Component = { key: keyof typeof ELITE_RESEARCH_WEIGHTS; value: number | null; availability: SignalAvailability };
  const mark = (key: keyof typeof ELITE_RESEARCH_WEIGHTS, value: number | null, present: boolean): Component => {
    if (unsupported.has(key)) return { key, value: null, availability: 'UNSUPPORTED' };
    return { key, value: present ? value : null, availability: present ? 'AVAILABLE' : 'MISSING' };
  };

  const components: Component[] = [
    mark('projectionVsLine', scoreProjection(rawEdge, input.projectionUncertainty), rawEdge != null),
    mark('opponentMatchup', 100, input.matchupAvailable),
    mark('usageOpportunity', 100, input.usageAvailable),
    mark('longTermBaseline', baseline, baseline != null),
    mark('recentForm', rawHitRate, rawHitRate != null),
    mark('expectedRole', 100, input.roleKnown),
    // Genuine cross-source projection agreement needs a second projection source; we have one.
    mark('projectionAgreement', null, false),
    mark('opponentPersonnel', 100, input.opponentPersonnelAvailable),
    mark('gameContext', 100, input.gameContextAvailable),
    mark('marketConfirmation', 100, input.marketConfirmationAvailable),
    mark('dataReliability', priceCurrent ? 100 : 40, input.lastUpdatedAt != null),
  ];

  const availableComponents = components.filter((c) => c.availability === 'AVAILABLE' && c.value != null);
  const supportableComponents = components.filter((c) => c.availability !== 'UNSUPPORTED');
  const availableWeight = availableComponents.reduce((sum, c) => sum + ELITE_RESEARCH_WEIGHTS[c.key], 0);
  const supportableWeight = supportableComponents.reduce((sum, c) => sum + ELITE_RESEARCH_WEIGHTS[c.key], 0);

  const evidenceStrength = availableWeight
    ? clamp(availableComponents.reduce((sum, c) => sum + (c.value ?? 0) * ELITE_RESEARCH_WEIGHTS[c.key], 0) / availableWeight)
    : 0;
  const evidenceCoverage = supportableWeight ? clamp((availableWeight / supportableWeight) * 100) : 0;

  // Coverage scales the score down, so LESS evidence can never outscore MORE evidence.
  const coverageFactor = 0.4 + 0.6 * (evidenceCoverage / 100);
  // Critical evidence: without a projection or any history, a near-perfect score is impossible.
  const criticalMissing = input.projection == null || !hasHistory || (input.sampleSize ?? 0) < ELITE_THRESHOLDS.minSampleSize;
  const researchScore = criticalMissing
    ? Math.min(40, clamp(evidenceStrength * coverageFactor))
    : clamp(evidenceStrength * coverageFactor);

  // ── data quality: RESEARCH data only. Price age is handled by priceFreshness, never counted twice. ──
  const qualityChecks: Array<{ ok: boolean; weight: number }> = [
    { ok: (input.sampleSize ?? 0) >= ELITE_THRESHOLDS.minSampleSize, weight: 2 },
    { ok: input.playerId != null, weight: 1 },
    { ok: input.matchupAvailable, weight: 1 },
    { ok: input.gameContextAvailable, weight: 1 },
    { ok: input.projection != null, weight: 2 },
    { ok: hasHistory, weight: 1 },
  ];
  if (input.sport === 'nfl') qualityChecks.push({ ok: input.statusKnown, weight: 1 });
  const qualityWeight = qualityChecks.reduce((sum, c) => sum + c.weight, 0);
  const dataQuality = clamp(qualityChecks.reduce((sum, c) => sum + (c.ok ? c.weight : 0), 0) / qualityWeight * 100);

  // ── independent signals. baseline+recentForm come from the SAME sample, so they collapse into one. ──
  const historicalSignalValue = baseline != null && rawHitRate != null ? (baseline + rawHitRate) / 2 : baseline ?? rawHitRate;
  const signalDefs: Array<{ key: string; value: number | null; availability: SignalAvailability }> = [
    { key: 'projectionVsLine', value: scoreProjection(rawEdge, input.projectionUncertainty), availability: rawEdge != null ? 'AVAILABLE' : 'MISSING' },
    { key: 'historicalPerformance', value: historicalSignalValue, availability: historicalSignalValue != null ? 'AVAILABLE' : 'MISSING' },
    { key: 'priceValue', value: evPercent != null ? clamp(50 + evPercent * 5) : null, availability: evPercent != null ? 'AVAILABLE' : 'MISSING' },
    { key: 'opponentMatchup', value: input.matchupAvailable ? 100 : null, availability: input.matchupAvailable ? 'AVAILABLE' : 'MISSING' },
    { key: 'expectedRole', value: input.roleKnown ? 100 : null, availability: input.roleKnown ? 'AVAILABLE' : 'MISSING' },
    { key: 'gameContext', value: input.gameContextAvailable ? 100 : null, availability: input.gameContextAvailable ? 'AVAILABLE' : 'MISSING' },
    { key: 'marketConfirmation', value: input.marketConfirmationAvailable ? 100 : null, availability: input.marketConfirmationAvailable ? 'AVAILABLE' : 'MISSING' },
    { key: 'usageOpportunity', value: null, availability: input.usageAvailable ? 'AVAILABLE' : 'UNSUPPORTED' },
    { key: 'opponentPersonnel', value: null, availability: input.opponentPersonnelAvailable ? 'AVAILABLE' : 'UNSUPPORTED' },
  ];
  const signals: SignalBreakdown[] = signalDefs.map((s) => ({
    key: s.key,
    availability: s.availability,
    value: s.value,
    agrees: s.availability === 'AVAILABLE' && s.value != null && s.value >= 60,
  }));
  const signalsAvailable = signals.filter((s) => s.availability === 'AVAILABLE' && s.value != null).length;
  const signalAgreement = signals.filter((s) => s.agrees).length;
  const signalsDisagreeing = signalsAvailable - signalAgreement;
  const signalsUnavailable = signals.length - signalsAvailable;
  const agreementRatio = signalsAvailable ? signalAgreement / signalsAvailable : null;

  // ── trap risk: only real, non-duplicated risks. Unsupported sources contribute ZERO. ──
  if (rates.length >= 2 && baseline != null && rawHitRate != null && Math.abs(rawHitRate - baseline) >= 25) {
    trapComponents.push({ reason: 'Recent results depend on an outlier shift', points: 18 });
  }
  if (input.sampleSize != null && input.sampleSize >= 5 && input.sampleSize < ELITE_THRESHOLDS.minSampleSize) {
    trapComponents.push({ reason: 'Small historical sample', points: 15 });
  }
  if (rawEdge != null && Math.abs(rawEdge) < 0.5) {
    trapComponents.push({ reason: 'Thin projection separation', points: 12 });
  }
  if (breakEvenProbability != null && breakEvenProbability >= 0.85) {
    trapComponents.push({ reason: 'Extreme juice: price requires an unrealistic win rate', points: 20 });
  }
  if (rawEv != null && rawEv < 0) {
    trapComponents.push({ reason: 'Negative expected value at this price', points: 15 });
  }
  if (evidenceCoverage < 50) {
    trapComponents.push({ reason: 'Low evidence coverage', points: 15 });
  }
  const trapRisk = clamp(trapComponents.reduce((sum, c) => sum + c.points, 0));
  const trapReasons = trapComponents.map((c) => c.reason);

  // ── qualification ──
  // valueQualified is independent of price age: a stale price can still tell us the bet WOULD be
  // good value if the price were current. priceCurrent is what gates whether that value is real NOW.
  const valueQualified = trueProbability != null && breakEvenProbability != null && rawEv != null && rawEv >= ELITE_THRESHOLDS.minEvPercent;
  const researchGatesPass =
    rejectedReasons.length === 0
    && !input.isAlternate
    && researchScore >= ELITE_THRESHOLDS.researchScore
    && signalsAvailable >= ELITE_THRESHOLDS.minSignalsAvailable
    && (agreementRatio ?? 0) >= ELITE_THRESHOLDS.minAgreementRatio
    && dataQuality >= ELITE_THRESHOLDS.dataQuality
    && trapRisk <= ELITE_THRESHOLDS.trapRisk
    && valueQualified;

  const researchQualified = researchGatesPass;
  const eliteQualified = researchGatesPass && priceCurrent;

  if (researchGatesPass && !priceCurrent) {
    rejectedReasons.push(`Price is ${priceFreshness.toLowerCase()} — cannot assert current EV without a fresh price`);
  }
  if (input.isAlternate && rejectedReasons.length === 0) {
    rejectedReasons.push('Alternate line — evaluated for price value, not eligible as a primary Elite pick');
  }

  const qualification: EliteQualificationLevel = eliteQualified
    ? 'ELITE'
    : rejectedReasons.length > 0 || dataQuality < 70 ? 'REJECT'
      : researchScore >= 75 ? 'WATCH' : 'STRONG';

  const whyQualified = eliteQualified ? [
    `Projection ${input.direction === 'over' ? 'above' : 'below'} the line by ${Math.abs(rawEdge ?? 0).toFixed(2)}`,
    `${signalAgreement}/${signalsAvailable} available research signals agree`,
    `${rawEv!.toFixed(1)}% expected value at ${input.oddsAmerican} with a ${priceFreshness.toLowerCase()} price`,
  ] : [];

  return {
    candidateId: input.candidateId,
    sport: input.sport,
    player: input.player,
    market: input.market,
    line: input.line,
    direction: input.direction,
    isAlternate: input.isAlternate,
    projection: input.projection,
    rawEdge,
    normalizedEdge,
    researchScore,
    evidenceStrength,
    evidenceCoverage,
    signalAgreement,
    signalsAvailable,
    signalsDisagreeing,
    signalsUnavailable,
    agreementRatio,
    signals,
    trapRisk,
    trapComponents,
    dataQuality,
    priceFreshness,
    priceCurrent,
    valueQualified,
    breakEvenProbability: breakEvenProbability != null ? Number((breakEvenProbability * 100).toFixed(1)) : null,
    modelProbability: model != null ? Number((model.probability * 100).toFixed(1)) : null,
    historicalHitRatePercent: observedHitRate != null ? Number((observedHitRate * 100).toFixed(1)) : null,
    trueProbability: trueProbability != null ? Number((trueProbability * 100).toFixed(1)) : null,
    trueProbabilityBasis: model != null && calibrated != null ? `${model.basis}; ${calibrated.basis}` : null,
    distributionUsed: model?.distribution ?? null,
    marketFamily: model?.family ?? null,
    zSeparation: model?.zSeparation ?? null,
    probabilityDivergence: calibrated?.divergence ?? null,
    priceEdgePercent: priceEdgePercent != null ? Number(priceEdgePercent.toFixed(1)) : null,
    evPercent: evPercent != null ? Number(evPercent.toFixed(1)) : null,
    rawHitRate,
    contextAdjustedHitRate: input.usageAvailable && input.roleKnown ? rawHitRate : null,
    qualification,
    eliteQualified,
    researchQualified,
    rejectedReasons,
    trapReasons,
    whyQualified,
    riskFactors: [...rejectedReasons, ...trapReasons],
    adapter: adapter?.label ?? 'Unavailable',
    marketSupport: input.marketSupport ?? 'SUPPORTED',
  };
}

/** MLB has no connected usage or opponent-personnel feed, so those signals are neutral, not risky. */
const MLB_UNSUPPORTED_SIGNALS: Array<keyof typeof ELITE_RESEARCH_WEIGHTS> = ['usageOpportunity', 'opponentPersonnel', 'projectionAgreement'];

export function finderResultToEliteCandidate(result: FinderResult): EliteCandidateInput {
  const rates = [result.historical.l5Rate, result.historical.l10Rate, result.historical.l20Rate, result.historical.seasonRate];
  const sampleSizes = [result.historical.l5, result.historical.l10, result.historical.l20, result.historical.season]
    .map((value) => Number(value.split('/')[1]))
    .filter((value) => Number.isFinite(value));
  return {
    candidateId: result.id,
    sport: result.sport ?? 'mlb',
    playerId: result.playerId,
    player: result.player,
    market: result.marketKey,
    line: result.line,
    direction: result.side,
    isAlternate: result.isAlternate,
    projection: result.projection,
    projectionUncertainty: result.projectionUncertainty,
    historicalRates: rates,
    sampleSize: sampleSizes.length ? Math.max(...sampleSizes) : null,
    oddsAmerican: result.bestBook?.odds ?? null,
    marketFairProbability: null,
    matchupAvailable: result.opponentName != null && result.opponentTeamId != null,
    usageAvailable: false,
    roleKnown: result.playerId != null,
    gameContextAvailable: result.gameTimeIso != null,
    opponentPersonnelAvailable: false,
    marketConfirmationAvailable: result.availableBooks >= 2,
    statusKnown: result.playerId != null,
    lastUpdatedAt: result.marketUpdatedAt,
    requiredMarketSupported: true,
    marketSupport: 'SUPPORTED',
    unsupportedSignals: MLB_UNSUPPORTED_SIGNALS,
  };
}

export function propResearchItemToEliteCandidate(prop: PropResearchItem): EliteCandidateInput {
  return {
    candidateId: prop.id,
    sport: prop.sport.toLowerCase() === 'nfl' ? 'nfl' : 'mlb',
    playerId: prop.playerId ?? null,
    player: prop.player,
    market: prop.marketKey ?? prop.propType,
    line: Number.isFinite(Number(prop.line)) ? Number(prop.line) : null,
    direction: prop.researchSide.toLowerCase() as 'over' | 'under',
    isAlternate: false,
    projection: prop.projectedValue || null,
    projectionUncertainty: null,
    historicalRates: [prop.hitRates.last5, prop.hitRates.last10, prop.hitRates.last20, prop.hitRates.season],
    sampleSize: prop.gameLog.length,
    oddsAmerican: null,
    marketFairProbability: null,
    matchupAvailable: prop.opponent !== 'Data unavailable',
    usageAvailable: prop.projectedPlateAppearances != null,
    roleKnown: prop.projectedBattingOrder != null || prop.projectedPlateAppearances != null,
    gameContextAvailable: prop.gameTime !== 'Data unavailable',
    opponentPersonnelAvailable: false,
    marketConfirmationAvailable: prop.hasSportsbookLine === true,
    statusKnown: prop.playerId != null,
    lastUpdatedAt: prop.oddsLastUpdate ?? null,
    requiredMarketSupported: prop.marketKey != null,
    marketSupport: prop.marketKey != null ? 'SUPPORTED' : 'UNAVAILABLE',
    unsupportedSignals: ['opponentPersonnel', 'projectionAgreement'],
  };
}
