import { describe, expect, it, vi } from 'vitest';
import { getNFLSpendTelemetry, recordNFLCacheRead, recordNFLProviderRequest, recordNFLProviderResponse, withNFLSpendTelemetry } from './spendTelemetry';

vi.mock('../odds/persistentCache', () => ({ readCreditStatus: vi.fn().mockRejectedValue(new Error('telemetry read failed')) }));

describe('authoritative request-local NFL spend telemetry', () => {
  it('records the exact full-slate 19709 to 19700 nine-credit case', async () => {
    await withNFLSpendTelemetry(async () => {
      recordNFLProviderRequest('event', ['player_pass_yds', 'player_receptions']);
      recordNFLProviderResponse(new Headers({ 'x-requests-remaining': '19700', 'x-requests-last': '9' }), true);
      expect(getNFLSpendTelemetry()).toMatchObject({ creditsBefore: 19709, creditsAfter: 19700, creditsSpent: 9, creditsConsumed: 9,
        paidRequestsMade: 1, providerRequestsMade: 1, refreshedGames: ['event'], actualSpendKnown: true, spendBasis: 'PROVIDER_HEADERS' });
      expect(getNFLSpendTelemetry()?.refreshedMarkets).toHaveLength(2);
    }, 19709);
  });
  it('cache-only repeat records zero spend and no refresh activity', async () => {
    await withNFLSpendTelemetry(async () => {
      recordNFLCacheRead(true);
      expect(getNFLSpendTelemetry()).toMatchObject({ creditsBefore: 19700, creditsAfter: 19700, creditsSpent: 0, cacheHits: 1, providerRequestsMade: 0, refreshedGames: [], refreshedMarkets: [] });
    }, 19700);
  });
  it('a free current balance replaces an older stored baseline before purchase', async () => {
    await withNFLSpendTelemetry(async () => {
      recordNFLProviderRequest();
      recordNFLProviderResponse(new Headers({ 'x-requests-remaining': '19709', 'x-requests-last': '0' }), false);
      recordNFLProviderRequest('event', ['player_pass_yds']);
      recordNFLProviderResponse(new Headers({ 'x-requests-remaining': '19700', 'x-requests-last': '9' }), true);
      expect(getNFLSpendTelemetry()).toMatchObject({ creditsBefore: 19709, creditsAfter: 19700, creditsConsumed: 9, providerRequestsMade: 2, paidRequestsMade: 1 });
    }, 20000);
  });
  it('read-only expired fixture access is marked stale without becoming a refresh', async () => {
    await withNFLSpendTelemetry(async () => {
      recordNFLCacheRead(true, true);
      expect(getNFLSpendTelemetry()).toMatchObject({ cacheHits: 1, staleCacheHits: 1, cacheMisses: 0, creditsConsumed: 0, refreshedGames: [] });
    }, 19700);
  });
  it('headers win over balance movement caused by unrelated concurrent usage', async () => {
    await withNFLSpendTelemetry(async () => {
      recordNFLProviderResponse(new Headers({ 'x-requests-remaining': '19690', 'x-requests-last': '9' }), true);
      expect(getNFLSpendTelemetry()?.creditsConsumed).toBe(9);
    }, 19709);
  });
  it('falls back to measured balance delta only when the cost header is absent', async () => {
    await withNFLSpendTelemetry(async () => {
      recordNFLProviderResponse(new Headers({ 'x-requests-remaining': '19700' }), true);
      expect(getNFLSpendTelemetry()).toMatchObject({ creditsConsumed: 9, spendBasis: 'BALANCE_DELTA' });
    }, 19709);
  });
  it('does not estimate spend from requested markets when headers/balances are missing', async () => {
    await withNFLSpendTelemetry(async () => {
      recordNFLProviderRequest('event', ['one', 'two', 'three']);
      recordNFLProviderResponse(new Headers(), true);
      expect(getNFLSpendTelemetry()).toMatchObject({ actualSpendKnown: false, spendBasis: 'UNKNOWN', creditsBefore: null, creditsAfter: null });
    }, null);
  });
  it('separate concurrent request trackers cannot overwrite each other', async () => {
    const results = await Promise.all([9, 3].map((cost) => withNFLSpendTelemetry(async () => {
      await Promise.resolve(); recordNFLProviderResponse(new Headers({ 'x-requests-remaining': String(100 - cost), 'x-requests-last': String(cost) }), true);
      return getNFLSpendTelemetry()?.creditsConsumed;
    }, 100)));
    expect(results).toEqual([9, 3]);
  });
  it('failure reading telemetry does not prevent an operation or cause another purchase', async () => {
    const operation = vi.fn(async () => { recordNFLCacheRead(true); return 'done'; });
    expect(await withNFLSpendTelemetry(operation)).toBe('done'); expect(operation).toHaveBeenCalledTimes(1);
  });
});