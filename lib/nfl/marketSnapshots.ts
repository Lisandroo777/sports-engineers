import { readStalePersistentCache, writePersistentCache } from '../odds/persistentCache';
import type { NFLMarketIntelligence } from './researchModel';

const MAX_NFL_PROP_SNAPSHOTS = 60;
const NFL_PROP_SNAPSHOT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

export interface NFLPropPriceSnapshotPoint {
  line: number;
  odds: number;
  observedAt: string;
  quoteUpdatedAt: string | null;
}

export interface NFLPropSnapshotInput {
  eventId: string;
  player: string;
  marketKey: string;
  sportsbookKey: string;
  side: 'over' | 'under';
  line: number;
  odds: number;
  retrievedAt: string | null;
  quoteUpdatedAt: string | null;
}

export function nflPropSnapshotKey(input: Pick<NFLPropSnapshotInput, 'eventId' | 'player' | 'marketKey' | 'sportsbookKey' | 'side'>): string {
  return `nfl-prop-price:v1:${input.eventId}:${input.player.trim().toLowerCase()}:${input.marketKey}:${input.sportsbookKey}:${input.side}`;
}

export async function getNFLPropPriceHistory(input: Pick<NFLPropSnapshotInput, 'eventId' | 'player' | 'marketKey' | 'sportsbookKey' | 'side'>): Promise<NFLPropPriceSnapshotPoint[]> {
  try { return (await readStalePersistentCache<NFLPropPriceSnapshotPoint[]>(nflPropSnapshotKey(input)))?.data ?? []; }
  catch { return []; }
}

export async function recordNFLPropPriceSnapshot(input: NFLPropSnapshotInput): Promise<NFLPropPriceSnapshotPoint[]> {
  const key = nflPropSnapshotKey(input);
  const history = await getNFLPropPriceHistory(input);
  const observedAt = input.retrievedAt && Number.isFinite(Date.parse(input.retrievedAt)) ? new Date(input.retrievedAt).toISOString() : new Date().toISOString();
  const point: NFLPropPriceSnapshotPoint = { line: input.line, odds: input.odds, observedAt, quoteUpdatedAt: input.quoteUpdatedAt };
  const duplicate = history.some((entry) => entry.line === point.line && entry.odds === point.odds && entry.observedAt === point.observedAt);
  const latest = history.reduce<NFLPropPriceSnapshotPoint | null>((value, entry) => !value || Date.parse(entry.observedAt) > Date.parse(value.observedAt) ? entry : value, null);
  if (!duplicate && (!latest || Date.parse(point.observedAt) >= Date.parse(latest.observedAt))) {
    const next = [...history, point].sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt)).slice(-MAX_NFL_PROP_SNAPSHOTS);
    try { await writePersistentCache(key, next, Date.now() + NFL_PROP_SNAPSHOT_TTL_MS); }
    catch { /* movement history is best-effort; never break candidate research */ }
    return next;
  }
  return history;
}

export function summarizeNFLPropPriceMovement(params: {
  history: NFLPropPriceSnapshotPoint[];
  currentLine: number;
  currentPrice: number;
  retrievedAt: string | null;
  valueQualified: boolean;
  priceCurrent: boolean;
}): NFLMarketIntelligence {
  const currentTime = params.retrievedAt && Number.isFinite(Date.parse(params.retrievedAt)) ? Date.parse(params.retrievedAt) : null;
  const matchingIndex = currentTime == null ? -1 : params.history.findIndex((point) => Date.parse(point.observedAt) === currentTime
    && point.line === params.currentLine && point.odds === params.currentPrice);
  const chronological = [...params.history].sort((left, right) => Date.parse(left.observedAt) - Date.parse(right.observedAt));
  const matchedIndex = matchingIndex >= 0 ? chronological.findIndex((point) => Date.parse(point.observedAt) === currentTime
    && point.line === params.currentLine && point.odds === params.currentPrice) : chronological.length - 1;
  const current = matchedIndex >= 0 ? chronological[matchedIndex] : null;
  const previous = matchedIndex > 0 ? chronological[matchedIndex - 1] : null;
  const first = chronological[0] ?? null;
  return {
    openingLine: null,
    firstObservedLine: first?.line ?? null,
    previousLine: previous?.line ?? null,
    currentLine: params.currentLine,
    openingPrice: null,
    previousPrice: previous?.odds ?? null,
    currentPrice: params.currentPrice,
    lineMovement: previous ? Number((params.currentLine - previous.line).toFixed(2)) : null,
    priceMovement: previous ? params.currentPrice - previous.odds : null,
    movementTimestamp: current?.observedAt ?? params.retrievedAt,
    movementReason: 'UNKNOWN',
    valueRemains: params.priceCurrent ? params.valueQualified : null,
    reEvaluatedAtCurrentLine: params.priceCurrent,
  };
}