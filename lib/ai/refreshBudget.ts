export const CONSERVATIVE_VALIDATION_COST_PER_GAME = 31;

export function canAuthorizeFullSlate(maximumEstimatedCost: number | null, availableCredits: number | null): boolean {
  return maximumEstimatedCost != null && availableCredits != null && maximumEstimatedCost <= availableCredits;
}

export function safelyResearchableGames(budget: number, scheduledGames: number): number {
  if (!Number.isFinite(budget) || budget <= 0 || scheduledGames <= 0) return 0;
  return Math.min(scheduledGames, Math.floor(budget / CONSERVATIVE_VALIDATION_COST_PER_GAME));
}
