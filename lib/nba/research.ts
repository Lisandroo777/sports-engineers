import { analyzePickCandidate, classifyPriceFreshness, type EliteCandidateInput, type EliteResearchAnalysis } from '../ai/eliteResearchFilter';
import { getNBAHistoricalValue, type NBAAnalyzableMarket } from './market';
import type { NBAGameLogEntry } from './types';
import type { NBAInjuryTier } from './injuries';

export interface NBAResearchCandidate {
  candidateId: string;
  playerId: number;
  player: string;
  market: NBAAnalyzableMarket;
  line: number | null;
  direction: 'over' | 'under';
  projection: number | null;
  projectionUncertainty: number | null;
  logs: NBAGameLogEntry[];
  matchupAvailable: boolean;
  /** Real ESPN injury tier for this player at candidate time. Drives statusKnown/roleKnown honestly. */
  injuryTier: NBAInjuryTier;
  /** Best available American price for this exact side, from the real sportsbook cache. */
  oddsAmerican: number | null;
  /** ISO timestamp the sportsbook price was last updated, used for price-currency gating. */
  lastUpdatedAt: string | null;
  isAlternate: boolean;
  /** Whether this market/stat mapping is computable from real ESPN game logs. */
  marketSupport: 'full' | 'partial' | 'unsupported';
  /** True only when a real ESPN opponent-context lookup (lib/nba/opponentContext.ts) found at
   *  least one supported metric for this game's opponent. Null/false leaves the signal UNSUPPORTED. */
  opponentContextAvailable?: boolean;
}

/** Converts real NBA logs into the shared Elite input without inventing projection, role, matchup, odds, or timestamp values. */
export function buildNBAEliteCandidate(candidate: NBAResearchCandidate): EliteCandidateInput {
  const values = candidate.logs
    .filter((log) => log.result != null)
    .map((log) => getNBAHistoricalValue(candidate.market, log.stats))
    .filter((value): value is number => value != null);
  // ACTIVE/QUESTIONABLE/DOUBTFUL are all "known" statuses; only UNKNOWN (no injury feed entry
  // parsed) means status is genuinely unresolved. OUT candidates should never reach this adapter —
  // the engine fails them closed before building a research candidate at all.
  const statusKnown = candidate.injuryTier !== 'UNKNOWN';
  return {
    candidateId: candidate.candidateId,
    sport: 'nba',
    playerId: candidate.playerId,
    player: candidate.player,
    market: candidate.market,
    line: candidate.line,
    direction: candidate.direction,
    isAlternate: candidate.isAlternate,
    projection: candidate.projection,
    projectionUncertainty: candidate.projectionUncertainty,
    historicalRates: candidate.line == null ? [] : values.map((value) => candidate.direction === 'over' ? value > candidate.line! ? 100 : 0 : value < candidate.line! ? 100 : 0),
    sampleSize: values.length,
    oddsAmerican: candidate.oddsAmerican,
    marketFairProbability: null,
    matchupAvailable: candidate.matchupAvailable,
    // Real usage evidence for NBA is expected minutes, computed as part of the projection itself —
    // treated as available whenever a projection exists, since projectNBAMarket already requires it.
    usageAvailable: candidate.projection != null,
    roleKnown: statusKnown,
    gameContextAvailable: candidate.logs.length > 0,
    // Real opponent-context evidence when the slate-level cache found supported metrics for this
    // game's opponent; otherwise stays unsupported below — never scored as "missing" evidence.
    opponentPersonnelAvailable: candidate.opponentContextAvailable === true,
    marketConfirmationAvailable: candidate.line != null,
    statusKnown,
    lastUpdatedAt: candidate.lastUpdatedAt,
    requiredMarketSupported: candidate.marketSupport !== 'unsupported',
    marketSupport: candidate.marketSupport === 'full' ? 'SUPPORTED' : candidate.marketSupport === 'partial' ? 'PARTIAL' : 'UNAVAILABLE',
    // projectionAgreement can never be genuinely evaluated (no second projection source anywhere).
    // opponentPersonnel is only unsupported when no real opponent-context evidence was found.
    unsupportedSignals: candidate.opponentContextAvailable === true ? ['projectionAgreement'] : ['projectionAgreement', 'opponentPersonnel'],
  };
}

/** Fail-closed NBA candidate analysis; the central engine remains the only qualification authority. */
export function analyzeNBACandidate(candidate: NBAResearchCandidate): EliteResearchAnalysis {
  return analyzePickCandidate(buildNBAEliteCandidate(candidate));
}

export { classifyPriceFreshness };

