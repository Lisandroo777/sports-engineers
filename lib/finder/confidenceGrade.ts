import type { EliteResearchAnalysis } from '../ai/eliteResearchFilter';
import type { OutlierDependency } from './outlierAnalysis';
import type { VolumeEfficiency } from './volumeEfficiency';

export type ConfidenceGrade = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'C' | 'D' | 'F';

/**
 * A letter grade layered ON TOP of the Elite Filter — it never changes `eliteQualified`, only adds
 * finer differentiation. A candidate that is not Elite-qualified can never grade above C, and A+/A
 * additionally require passing the outlier-dependency and volume-efficiency checks, so a technically
 * qualified pick that is secretly one outlier game away from missing still gets capped at B+.
 */
export function computeConfidenceGrade(params: {
  analysis: EliteResearchAnalysis;
  outlier: OutlierDependency;
  volumeEfficiency: VolumeEfficiency;
}): ConfidenceGrade {
  const { analysis, outlier, volumeEfficiency } = params;

  if (analysis.rejectedReasons.length > 0 || analysis.dataQuality < 50) return 'F';

  if (!analysis.eliteQualified) {
    if (analysis.researchScore >= 75 && analysis.trapRisk <= 35) return 'C';
    if (analysis.researchScore >= 60) return 'D';
    return 'F';
  }

  const outlierRisk = outlier.available && outlier.explosiveDependencePercent != null && outlier.explosiveDependencePercent >= 35;
  const volumeRisk = volumeEfficiency.available && volumeEfficiency.meetsRequiredRate === false;
  if (outlierRisk || volumeRisk) return 'B+';

  const fullAgreement = (analysis.agreementRatio ?? 0) >= 1;
  if (analysis.researchScore >= 95 && fullAgreement && analysis.trapRisk <= 10) return 'A+';
  if (analysis.researchScore >= 90 && fullAgreement) return 'A';
  return 'A-';
}
