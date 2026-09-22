import type { FinderResult } from './engine';
import type { EliteResearchAnalysis } from '../ai/eliteResearchFilter';
import { computeConfidenceGrade, type ConfidenceGrade } from './confidenceGrade';
import { buildEvidenceBoard, type EvidenceEntry } from './evidenceBoard';
import type { AlternateLineOption } from './alternateLineOptimizer';
import { americanToImpliedProbability } from '../odds/math';

export interface DeepResearchCard {
  grade: ConfidenceGrade;
  breakEvenProbability: number | null;
  /** Difference between recent hit rate and the price's break-even requirement — the player-quality edge, separate from the price edge. */
  playerEdgePercent: number | null;
  priceEdgePercent: number | null;
  priceGrade: 'A' | 'B' | 'C' | 'D' | 'unavailable';
  roleConfidence: 'High' | 'Medium' | 'Low' | 'Unavailable';
  matchupGrade: 'Available' | 'Unavailable';
  projectedRange: { low: number; high: number } | null;
  bestAlternateLine: AlternateLineOption | null;
  howItLoses: string[];
  evidenceBoard: EvidenceEntry[];
  sources: string[];
  dataFreshness: string | null;
}

function priceGradeFromEv(evPercent: number | null): DeepResearchCard['priceGrade'] {
  if (evPercent == null) return 'unavailable';
  if (evPercent >= 5) return 'A';
  if (evPercent >= 0) return 'B';
  if (evPercent >= -5) return 'C';
  return 'D';
}

/** Assembles the Final Pick Card from real data already attached to the FinderResult plus its Elite Filter verdict. Computes no new metrics that require a fetch. */
export function buildDeepResearchCard(result: FinderResult, analysis: EliteResearchAnalysis): DeepResearchCard {
  const outlier = result.outlierDependency;
  const volumeEfficiency = result.volumeEfficiency;
  const altLines = result.alternateLineOptimizer;

  const breakEvenProbability = result.bestBook?.odds != null ? americanToImpliedProbability(result.bestBook.odds) : null;
  const l10Rate = result.historical.l10Rate;
  const seasonRate = result.historical.seasonRate;
  const playerEdgePercent = l10Rate != null && breakEvenProbability != null ? Number((l10Rate - breakEvenProbability * 100).toFixed(1)) : null;

  const median = outlier.available ? outlier.median : null;
  const standardDeviation = outlier.available ? outlier.standardDeviation : null;
  const projectedRange = median != null && standardDeviation != null
    ? { low: Math.max(0, Number((median - standardDeviation).toFixed(2))), high: Number((median + standardDeviation).toFixed(2)) }
    : null;

  return {
    grade: computeConfidenceGrade({ analysis, outlier, volumeEfficiency }),
    breakEvenProbability: breakEvenProbability != null ? Number((breakEvenProbability * 100).toFixed(1)) : null,
    playerEdgePercent,
    priceEdgePercent: result.evPercent != null ? Number(result.evPercent.toFixed(1)) : null,
    priceGrade: priceGradeFromEv(result.evPercent),
    roleConfidence: result.playerId == null ? 'Unavailable' : (outlier.available && outlier.sampleGames >= 10 ? 'High' : outlier.sampleGames > 0 ? 'Medium' : 'Low'),
    matchupGrade: result.opponentName != null ? 'Available' : 'Unavailable',
    projectedRange,
    bestAlternateLine: altLines.recommended,
    howItLoses: result.howItLoses,
    evidenceBoard: buildEvidenceBoard({
      side: result.side,
      rawEdge: analysis.rawEdge,
      l10Rate,
      seasonRate,
      matchupAvailable: result.opponentName != null,
      roleKnown: result.playerId != null,
      sport: result.sport,
      outlierDependencePercent: outlier.available ? outlier.explosiveDependencePercent : null,
      injuryKnown: result.playerId != null,
      priceValueAvailable: analysis.evPercent != null,
      priceValueDetail: analysis.evPercent != null ? `${analysis.evPercent.toFixed(1)}% EV at the best current price` : undefined,
      crossBookDiscrepancy: result.crossBookThreshold.available ? result.crossBookThreshold.discrepancy : null,
      marketMovementAvailable: result.marketMovement.available,
    }),
    sources: result.sources,
    dataFreshness: result.marketUpdatedAt,
  };
}
