import type { SnapshotPoint } from '../odds/snapshotStore';

export type MarketMovementDirection = 'shortened' | 'lengthened' | 'stable' | 'unavailable';

export interface MarketMovementSignal {
  available: boolean;
  direction: MarketMovementDirection;
  openingOdds: number | null;
  currentOdds: number | null;
  observedOverMinutes: number | null;
  pointCount: number;
  /** Human-readable, explicitly labeled "Sharp-like market signal" — never called confirmed sharp money. */
  label: string | null;
}

const UNAVAILABLE: MarketMovementSignal = {
  available: false, direction: 'unavailable', openingOdds: null, currentOdds: null,
  observedOverMinutes: null, pointCount: 0, label: null,
};

/** American-odds "distance to even money" — used only to judge shortened vs lengthened, not implied probability. */
function oddsMagnitudeToward100(odds: number) {
  return odds < 0 ? Math.abs(odds) : odds;
}

/** Derives real line movement from persisted snapshot history — never fabricates a trend from a single point. */
export function computeMarketMovement(history: SnapshotPoint[]): MarketMovementSignal {
  if (history.length < 2) return UNAVAILABLE;

  const opening = history[0];
  const current = history[history.length - 1];
  if (opening.odds === current.odds) {
    return {
      available: true, direction: 'stable', openingOdds: opening.odds, currentOdds: current.odds,
      observedOverMinutes: Math.round((current.timestamp - opening.timestamp) / 60000),
      pointCount: history.length, label: `Line has held steady at ${current.odds > 0 ? '+' : ''}${current.odds} across ${history.length} observations.`,
    };
  }

  // Odds moving toward favorite (more negative / less positive) = book expects the outcome more often = "shortened".
  const shortened = oddsMagnitudeToward100(current.odds) > oddsMagnitudeToward100(opening.odds) && current.odds < 0
    || (opening.odds > 0 && current.odds <= 0)
    || (opening.odds > 0 && current.odds > 0 && current.odds < opening.odds);
  const direction: MarketMovementDirection = shortened ? 'shortened' : 'lengthened';
  const minutes = Math.round((current.timestamp - opening.timestamp) / 60000);

  return {
    available: true,
    direction,
    openingOdds: opening.odds,
    currentOdds: current.odds,
    observedOverMinutes: minutes,
    pointCount: history.length,
    label: `Sharp-like market signal: price moved from ${opening.odds > 0 ? '+' : ''}${opening.odds} to ${current.odds > 0 ? '+' : ''}${current.odds} (${direction}) over ${minutes} min across ${history.length} observations.`,
  };
}
