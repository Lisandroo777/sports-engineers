export function americanToDecimalOdds(odds: number) {
  if (!Number.isFinite(odds) || odds === 0) return null;
  return odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
}

export function americanToImpliedProbability(odds: number) {
  if (!Number.isFinite(odds) || odds === 0) return null;
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100);
}

export function removeTwoWayVig(overOdds: number, underOdds: number) {
  const over = americanToImpliedProbability(overOdds);
  const under = americanToImpliedProbability(underOdds);
  if (over == null || under == null || over + under === 0) return null;
  return { over: over / (over + under), under: under / (over + under) };
}

export function fairAmericanOdds(probability: number) {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) return null;
  const odds = probability >= 0.5 ? -100 * probability / (1 - probability) : 100 * (1 - probability) / probability;
  return Math.round(odds);
}

export function expectedValuePercent(fairProbability: number, americanOdds: number) {
  const decimal = americanToDecimalOdds(americanOdds);
  if (decimal == null || !Number.isFinite(fairProbability)) return null;
  return (fairProbability * decimal - 1) * 100;
}

export function consensusProbability(probabilities: number[]) {
  const valid = probabilities.filter((probability) => Number.isFinite(probability) && probability > 0 && probability < 1);
  if (!valid.length) return null;
  return valid.reduce((sum, probability) => sum + probability, 0) / valid.length;
}
