import { AsyncLocalStorage } from 'node:async_hooks';
import type { OddsSpendTracker } from '../odds/client';
import { readCreditStatus } from '../odds/persistentCache';

export interface NFLSpendTelemetry extends OddsSpendTracker {
  providerRequestsMade: number;
  creditsConsumed: number;
  refreshedGames: string[];
  refreshedMarkets: Array<{ eventId: string; market: string }>;
  actualSpendKnown: boolean;
  spendBasis: 'NONE' | 'PROVIDER_HEADERS' | 'BALANCE_DELTA' | 'MIXED' | 'UNKNOWN';
}

const scope = new AsyncLocalStorage<NFLSpendTelemetry>();
function number(value: string | null | undefined): number | null {
  if (value == null || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export async function withNFLSpendTelemetry<T>(operation: () => Promise<T>, initialBalance?: number | null): Promise<T> {
  if (scope.getStore()) return operation();
  let balance = initialBalance;
  if (balance === undefined) {
    try { balance = number((await readCreditStatus())?.remaining); } catch { balance = null; }
  }
  const tracker: NFLSpendTelemetry = {
    creditsBefore: balance ?? null, creditsAfter: balance ?? null, creditsSpent: 0, creditsConsumed: 0,
    paidRequestsMade: 0, providerRequestsMade: 0, cacheHits: 0, staleCacheHits: 0, cacheMisses: 0,
    refreshedGames: [], refreshedMarkets: [], actualSpendKnown: true, spendBasis: 'NONE',
  };
  return scope.run(tracker, operation);
}

export function getNFLSpendTelemetry(): NFLSpendTelemetry | null { return scope.getStore() ?? null; }

export function recordNFLProviderRequest(eventId?: string, markets: string[] = []): void {
  const tracker = scope.getStore();
  if (!tracker) return;
  tracker.providerRequestsMade += 1;
  if (!eventId) return;
  tracker.paidRequestsMade += 1;
  if (!tracker.refreshedGames.includes(eventId)) tracker.refreshedGames.push(eventId);
  for (const market of markets) if (!tracker.refreshedMarkets.some((entry) => entry.eventId === eventId && entry.market === market)) tracker.refreshedMarkets.push({ eventId, market });
}

export function recordNFLProviderResponse(headers: Headers, paid: boolean): void {
  const tracker = scope.getStore();
  if (!tracker) return;
  const after = number(headers.get('x-requests-remaining'));
  const before = tracker.creditsAfter;
  const charged = number(headers.get('x-requests-last'));
  if (paid) {
    const actual = charged ?? (before != null && after != null && before >= after ? before - after : null);
    if (actual == null) {
      tracker.actualSpendKnown = false;
      tracker.spendBasis = 'UNKNOWN';
    } else {
      tracker.creditsConsumed += actual;
      tracker.creditsSpent = tracker.creditsConsumed;
      const basis = charged != null ? 'PROVIDER_HEADERS' : 'BALANCE_DELTA';
      if (tracker.actualSpendKnown) tracker.spendBasis = tracker.spendBasis === 'NONE' || tracker.spendBasis === basis ? basis : 'MIXED';
      if (tracker.creditsBefore == null && after != null) tracker.creditsBefore = after + actual;
    }
  } else if (after != null && tracker.paidRequestsMade === 0) tracker.creditsBefore = after;
  if (after != null) tracker.creditsAfter = after;
}

export function recordNFLProviderFailure(paid = true): void {
  const tracker = scope.getStore();
  if (tracker && paid) { tracker.actualSpendKnown = false; tracker.spendBasis = 'UNKNOWN'; }
}

export function recordNFLCacheRead(fresh: boolean, recordedExpired = false): void {
  const tracker = scope.getStore();
  if (!tracker) return;
  if (fresh) tracker.cacheHits += 1;
  else tracker.cacheMisses += 1;
  if (recordedExpired) tracker.staleCacheHits += 1;
}