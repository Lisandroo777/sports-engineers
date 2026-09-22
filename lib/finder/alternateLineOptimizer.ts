import { americanToImpliedProbability, expectedValuePercent, removeTwoWayVig } from '../odds/math';
import type { NormalizedProp } from '../odds/types';

export type AlternateLineBand = 'GO' | 'PLAYABLE' | 'MARGINAL' | 'PASS';

export interface AlternateLineOption {
  line: number;
  side: 'over' | 'under';
  bestBook: string | null;
  bestOdds: number | null;
  /** Vig-removed fair probability (%), from books that post both sides of this line. Null if unavailable. */
  trueProbability: number | null;
  /** Implied probability (%) of the best offered price alone — what you'd need to hit to break even. */
  breakEvenProbability: number | null;
  edgePercent: number | null;
  band: AlternateLineBand;
}

export interface AlternateLineOptimizerResult {
  available: boolean;
  side: 'over' | 'under';
  /** Every threshold actually posted for this player+market, from the real props already fetched for this event. */
  options: AlternateLineOption[];
  recommended: AlternateLineOption | null;
}

function bandFor(edgePercent: number | null, trueProbability: number | null): AlternateLineBand {
  if (edgePercent == null) return 'PASS';
  if (edgePercent >= 5 && trueProbability != null && trueProbability >= 0.55) return 'GO';
  if (edgePercent >= 2) return 'PLAYABLE';
  if (edgePercent >= -2) return 'MARGINAL';
  return 'PASS';
}

/**
 * Compares every real posted threshold (standard + alternate) for one player+market from the props
 * already fetched for this event, and recommends the best risk-adjusted one. Makes no new requests —
 * operates only on data DeepSide has already paid for and cached.
 */
export function computeAlternateLineOptimizer(
  eventProps: NormalizedProp[],
  player: string,
  canonicalMarketKey: string,
  side: 'over' | 'under',
): AlternateLineOptimizerResult {
  const relevant = eventProps.filter((prop) => prop.player === player && prop.marketKey === canonicalMarketKey);
  if (relevant.length === 0) return { available: false, side, options: [], recommended: null };

  const byLine = new Map<number, NormalizedProp[]>();
  for (const prop of relevant) byLine.set(prop.line, [...(byLine.get(prop.line) ?? []), prop]);

  const options: AlternateLineOption[] = [];
  for (const [line, props] of byLine) {
    const paired = props.filter((prop) => prop.overOdds != null && prop.underOdds != null);
    const probs = paired
      .map((prop) => removeTwoWayVig(prop.overOdds!, prop.underOdds!)?.[side])
      .filter((value): value is number => value != null);
    const trueProbability = probs.length ? probs.reduce((sum, value) => sum + value, 0) / probs.length : null;

    const sideOdds = props.map((prop) => (side === 'over' ? prop.overOdds : prop.underOdds)).filter((value): value is number => value != null);
    if (!sideOdds.length) continue;
    const bestOddsValue = sideOdds.reduce((best, odds) => (odds > best ? odds : best), sideOdds[0]);
    const bestBookProp = props.find((prop) => (side === 'over' ? prop.overOdds : prop.underOdds) === bestOddsValue);
    const breakEvenProbability = americanToImpliedProbability(bestOddsValue);
    const edgePercent = trueProbability != null ? expectedValuePercent(trueProbability, bestOddsValue) : null;

    options.push({
      line,
      side,
      bestBook: bestBookProp?.sportsbookName ?? null,
      bestOdds: bestOddsValue,
      trueProbability: trueProbability != null ? Number((trueProbability * 100).toFixed(1)) : null,
      breakEvenProbability: breakEvenProbability != null ? Number((breakEvenProbability * 100).toFixed(1)) : null,
      edgePercent: edgePercent != null ? Number(edgePercent.toFixed(1)) : null,
      band: bandFor(edgePercent, trueProbability),
    });
  }

  options.sort((a, b) => (side === 'over' ? a.line - b.line : b.line - a.line));
  const playable = options.filter((option) => option.band === 'GO' || option.band === 'PLAYABLE');
  const recommended = playable.length
    ? playable.reduce((best, option) => ((option.edgePercent ?? -Infinity) > (best.edgePercent ?? -Infinity) ? option : best), playable[0])
    : null;

  return { available: options.length > 0, side, options, recommended };
}
