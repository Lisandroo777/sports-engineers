export const CONSERVATIVE_VALIDATION_COST_PER_GAME = 31;

export function canAuthorizeFullSlate(maximumEstimatedCost: number | null, availableCredits: number | null): boolean {
  return maximumEstimatedCost != null && availableCredits != null && maximumEstimatedCost <= availableCredits;
}

/**
 * How many games an authorized budget can actually research.
 *
 * `costPerPaidGame` must be the sport's own conservative per-game estimate (MLB ~31, NFL ~61) so the
 * count never promises more games than the credit cap can pay for. `freeGames` are games whose props
 * are already cached: they spend nothing, so they are researchable on any budget and are what allows
 * a small cap to still return research instead of blocking.
 */
export function safelyResearchableGames(
  budget: number,
  scheduledGames: number,
  costPerPaidGame: number = CONSERVATIVE_VALIDATION_COST_PER_GAME,
  freeGames = 0,
): number {
  if (scheduledGames <= 0) return 0;
  const free = Math.min(scheduledGames, Math.max(0, freeGames));
  const perGame = Number.isFinite(costPerPaidGame) && costPerPaidGame > 0 ? costPerPaidGame : CONSERVATIVE_VALIDATION_COST_PER_GAME;
  const affordablePaidGames = Number.isFinite(budget) && budget > 0 ? Math.floor(budget / perGame) : 0;
  return Math.min(scheduledGames, free + affordablePaidGames);
}
