import { NBA_MARKET_LABELS } from '../market';
import { getNBAHistoricalValue } from '../market';
import type { NBAProjectionInput, NBAProjectionResult } from './types';
import { getNBAWindowValues, nbaExplosiveOutlierShare, nbaHistoricalPushRate, nbaHistoricalWindowRates, sampleMean, sampleVariance, selectNBAAsOfHistory } from './history';
import { estimateNBAMarketOpportunity, estimateNBAMinutes } from './minutes';
import { buildNBAMarketDistribution, nbaComponentCorrelations } from './distribution';
import { americanImpliedProbability, nbaExpectedValuePercent, nbaFairAmericanOdds, noVigMarketProbability, settleNBAProbabilities } from './pricing';
import { NBA_MODEL_VALIDATION_STATUS, NBA_MODEL_VERSION } from './version';
import { adaptNBAAgent2Context } from './contextAdapter';
import type { NBAAnalyzableMarket as Market } from '../market';

const COMBO_PARTS: Partial<Record<Market, Market[]>> = { pra: ['points', 'rebounds', 'assists'], pr: ['points', 'rebounds'], pa: ['points', 'assists'], ra: ['rebounds', 'assists'] };
const MINIMUM_STAT_GAMES = 8;
const MAX_QUOTE_AGE_MS = 60 * 60 * 1000;

function getMarketValues(observations: ReturnType<typeof selectNBAAsOfHistory>, market: Market) {
  return getNBAWindowValues(observations, market);
}

export function predictNBAMarket(input: NBAProjectionInput): NBAProjectionResult {
  const targetTipoffMs = Date.parse(input.targetTipoff);
  const context = input.researchContext ? adaptNBAAgent2Context({ researchContext: input.researchContext, intelligenceSnapshot: input.intelligenceSnapshot,
    playerId: input.playerId, teamId: input.teamId, gameId: input.targetGameId, targetTipoff: input.targetTipoff, targetSeason: input.targetSeason,
    targetPhase: input.targetPhase, market: input.market }) : null;
  const injury = context?.injury ?? input.injury;
  const observations = selectNBAAsOfHistory({ observations: input.observations, targetTipoff: input.targetTipoff,
    targetGameId: input.targetGameId, targetSeason: input.targetSeason, targetPhase: input.targetPhase });
  const marketValues = getMarketValues(observations, input.market);
  const values = marketValues.map(({ value }) => value);
  const hasLine = input.line != null && Number.isFinite(input.line);
  const marketEntries = observations.flatMap(({ log, source }) => {
    const value = getNBAHistoricalValue(input.market, log.stats);
    const minutes = log.stats.minutes;
    return value != null && minutes != null && Number.isFinite(minutes) && minutes >= 5 ? [{ gameId: log.gameId, value, minutes, source }] : [];
  });
  const rateEligibleGameIds = new Set(marketEntries.map((entry) => entry.gameId));
  const rateValues = marketValues.filter((entry) => rateEligibleGameIds.has(entry.gameId)).map((entry) => entry.value);
  const windowRates = hasLine ? nbaHistoricalWindowRates(rateValues, input.line!, input.direction ?? 'over') : { l5: null, l10: null, l20: null, season: null };
  const minutes = estimateNBAMinutes({ observations, injury, context });
  const opportunity = estimateNBAMarketOpportunity({ marketValues: marketEntries, expectedMinutes: minutes.mean });
  const reasons = [...minutes.reasons];
  if (context?.missing.length) reasons.push('RESEARCH_CONTEXT_HAS_MISSING_COVERAGE');
  let expectedStat: number | null = null;
  let statUncertainty: number | null = null;
  const sampleSize = marketValues.length;
  const availableSampleSize = marketEntries.length;
  if (injury === 'OUT') reasons.push('PLAYER_REPORTED_OUT');
  if (minutes.mean == null || opportunity.ratePerMinute == null || availableSampleSize < MINIMUM_STAT_GAMES || injury === 'OUT') {
    reasons.push(availableSampleSize < MINIMUM_STAT_GAMES ? 'INSUFFICIENT_MARKET_SAMPLE' : 'UNAVAILABLE_MARKET_RATE');
  } else {
    expectedStat = opportunity.ratePerMinute * minutes.mean;
    const rateCv = opportunity.rateUncertainty != null && opportunity.ratePerMinute > 0 ? opportunity.rateUncertainty / opportunity.ratePerMinute : 0;
    const minuteCv = minutes.uncertainty != null && minutes.mean > 0 ? minutes.uncertainty / minutes.mean : 0;
    statUncertainty = Math.max(0.25, expectedStat * Math.sqrt(rateCv ** 2 + minuteCv ** 2));
    if (context?.minutesRestricted) reasons.push('VERIFIED_MINUTES_RESTRICTION_REQUIRES_REVIEW');
  }
  const historicalOutlierShare = nbaExplosiveOutlierShare(values);
  const components = COMBO_PARTS[input.market];
  const modelObservations = observations.filter(({ log }) => log.stats.minutes != null && log.stats.minutes >= 5
    && getNBAHistoricalValue(input.market, log.stats) != null);
  const componentCorrelations = components ? nbaComponentCorrelations(modelObservations, components) : null;
  if (components && componentCorrelations == null) reasons.push('COMBINATION_CORRELATION_SMALL_SAMPLE');
  const reliability: NBAProjectionResult['reliability'] = expectedStat == null || statUncertainty == null ? 'UNRELIABLE'
    : minutes.reliability === 'UNRELIABLE' || availableSampleSize < MINIMUM_STAT_GAMES ? 'UNRELIABLE'
      : minutes.reliability === 'LOW' || availableSampleSize < 12 || components && componentCorrelations == null ? 'LOW'
        : minutes.reliability === 'MEDIUM' || injury === 'QUESTIONABLE' || injury === 'PROBABLE' || injury === 'REPORT_MISSING' ? 'MEDIUM' : 'HIGH';
  const distribution = expectedStat != null && statUncertainty != null
    ? buildNBAMarketDistribution({ market: input.market, observations: modelObservations, expectedMean: expectedStat, uncertainty: statUncertainty }) : null;
  const probabilities = distribution && hasLine ? settleNBAProbabilities(distribution, input.line!) : null;
  const modelAsOf = targetTipoffMs - 1;
  const quoteTime = input.quoteTimestamp ? Date.parse(input.quoteTimestamp) : Number.NaN;
  const quoteStatus: NBAProjectionResult['quoteStatus'] = input.americanOdds == null || !input.sportsbook || !Number.isFinite(quoteTime) ? 'UNAVAILABLE'
    : quoteTime >= targetTipoffMs ? 'AFTER_PREDICTION'
      : modelAsOf - quoteTime > MAX_QUOTE_AGE_MS ? 'STALE' : 'CURRENT';
  const impliedProbability = input.americanOdds == null ? null : americanImpliedProbability(input.americanOdds);
  const opposite = input.oppositeQuote;
  const pairedQuoteIsComparable = input.line != null && input.direction != null && input.americanOdds != null
    && input.sportsbook != null && input.quoteTimestamp != null && opposite != null
    && opposite.market === input.market && opposite.line === input.line && opposite.direction !== input.direction
    && opposite.sportsbook === input.sportsbook && opposite.quoteTimestamp === input.quoteTimestamp;
  const noVigProbability = pairedQuoteIsComparable && opposite
    ? noVigMarketProbability(input.americanOdds!, opposite.americanOdds) : null;
  const rawExpectedValuePercent = probabilities && input.direction && input.americanOdds != null
    ? nbaExpectedValuePercent({ outcomes: probabilities, direction: input.direction, americanOdds: input.americanOdds }) : null;
  const expectedValuePercent = quoteStatus === 'CURRENT' ? rawExpectedValuePercent : null;
  const directionalEdge = expectedStat != null && input.line != null
    ? input.direction === 'under' ? input.line - expectedStat : expectedStat - input.line : null;
  const valueQualified = quoteStatus === 'CURRENT' && expectedValuePercent != null && expectedValuePercent > 0 && directionalEdge != null && directionalEdge > 0;
  const pushRate = hasLine ? nbaHistoricalPushRate(values, input.line!) : null;
  if (pushRate != null && pushRate > 0) reasons.push('WHOLE_LINE_HISTORICAL_PUSHES');
  const eligibleForReview = (reliability === 'HIGH' || reliability === 'MEDIUM') && valueQualified;
  if (reliability === 'HIGH' || reliability === 'MEDIUM') {
    if (quoteStatus !== 'CURRENT') reasons.push(`PRICE_${quoteStatus}`);
    else if (!valueQualified) reasons.push('NO_POSITIVE_EDGE_AND_EV');
  }
  const fairOdds = probabilities ? nbaFairAmericanOdds({ outcomes: probabilities, direction: input.direction ?? 'over' }) : null;
  return {
    modelVersion: NBA_MODEL_VERSION, validationStatus: NBA_MODEL_VALIDATION_STATUS,
    playerId: input.playerId, playerName: input.playerName, market: input.market, targetPhase: input.targetPhase,
    targetSeason: input.targetSeason, asOf: new Date(Date.parse(input.targetTipoff) - 1).toISOString(),
    expectedMinutes: minutes.mean, minutesUncertainty: minutes.uncertainty, minutesSampleSize: minutes.sampleSize,
    expectedStat: expectedStat == null ? null : Number(expectedStat.toFixed(3)), statUncertainty: statUncertainty == null ? null : Number(statUncertainty.toFixed(3)),
      sampleSize, availableSampleSize, reliability, reasons: [...new Set(reasons)], historyRates: windowRates,
    opportunitiesUsed: opportunity.sources, componentCorrelations,
    probabilities, quoteStatus, impliedProbability, noVigMarketProbability: noVigProbability,
    fairAmericanOdds: fairOdds,
    expectedValuePercent, directionalEdge, valueQualified, historicalOutlierShare,
    researchContextVersion: context?.contextSchemaVersion ?? null, intelligenceSnapshotId: context?.intelligenceSnapshotId ?? null,
    contextEvidence: context?.contextEvidence ?? [], intelligenceEvidence: context?.intelligenceEvidence ?? [], contextMissing: context?.missing ?? [],
    eligibleForReview,
  };
}

export function diagnosticNBAStats(input: NBAProjectionInput) {
  const observations = selectNBAAsOfHistory({ observations: input.observations, targetTipoff: input.targetTipoff,
    targetGameId: input.targetGameId, targetSeason: input.targetSeason, targetPhase: input.targetPhase });
  const values = getMarketValues(observations, input.market).map(({ value }) => value);
  return { observationGameIds: observations.map(({ log }) => log.gameId), marketGameIds: values.length,
    mean: sampleMean(values), variance: sampleVariance(values), outlierShare: nbaExplosiveOutlierShare(values), label: NBA_MARKET_LABELS[input.market] };
}
