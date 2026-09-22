/** Centralized FinderScore weighting. Change here only; never inline weights in components. */
export const FINDER_SCORE_WEIGHTS = {
  historicalPerformance: 0.25,
  matchupQuality: 0.20,
  marketValue: 0.25,
  marketAgreement: 0.15,
  recentTrend: 0.10,
  dataQuality: 0.05,
} as const;

export const FINDER_GRADE_THRESHOLDS = [
  { min: 90, grade: 'Elite' },
  { min: 85, grade: 'Strong' },
  { min: 80, grade: 'Good' },
  { min: 75, grade: 'Watch' },
] as const;

export function getFinderGrade(score: number): string | null {
  for (const tier of FINDER_GRADE_THRESHOLDS) {
    if (score >= tier.min) return tier.grade;
  }
  return null;
}

export const FINDER_MIN_GRADE_SCORE = 75;
