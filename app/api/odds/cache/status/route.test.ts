import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  storage: vi.fn(), credits: vi.fn(), budget: vi.fn(), enabled: vi.fn(), limits: vi.fn(),
}));
vi.mock('@/lib/storage/kv', () => ({ getDurableKVStatus: state.storage }));
vi.mock('@/lib/odds/persistentCache', () => ({ readCreditStatus: state.credits }));
vi.mock('@/lib/odds/budget', () => ({ getOddsBudgetStatus: state.budget }));
vi.mock('@/lib/odds/autoRefreshLedger', () => ({ isAutomaticOddsRefreshEnabled: state.enabled, getOddsRefreshLimits: state.limits }));
import { GET } from './route';

beforeEach(() => {
  state.storage.mockReturnValue({ configured: true, source: 'UPSTASH_REDIS_REST', bothFamiliesPresent: false });
  state.credits.mockResolvedValue({ remaining: '16966', lastCost: '0' });
  state.budget.mockResolvedValue({ remaining: 16966, belowReserve: false });
  state.enabled.mockReturnValue(false);
  state.limits.mockReturnValue({ perSearchCredits: 50, dailyCredits: 300, minProviderRemaining: 2000 });
});
afterEach(() => vi.resetAllMocks());

describe('masked storage readiness', () => {
  it('reports readable Redis separately from automatic refresh activation', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      storage: { configured: true, readable: true, source: 'UPSTASH_REDIS_REST' },
      automaticRefresh: { enabled: false, limits: { perSearchCredits: 50, dailyCredits: 300, minProviderRemaining: 2000 } },
    });
  });

  it('does not report missing storage as a healthy null balance', async () => {
    state.storage.mockReturnValue({ configured: false, source: null, bothFamiliesPresent: false });
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: 'REDIS_NOT_CONFIGURED' });
    expect(state.credits).not.toHaveBeenCalled();
  });

  it.each([401, 403])('classifies Redis HTTP %s without exposing credentials', async (status) => {
    state.credits.mockRejectedValue(new Error(`Durable KV request failed (${status})`));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'REDIS_AUTH_REJECTED' });
  });

  it('sanitizes unexpected provider errors', async () => {
    state.credits.mockRejectedValue(new Error('secret-token https://private-endpoint.test'));
    expect(await (await GET()).json()).toEqual({ error: 'REDIS_UNAVAILABLE' });
  });

  it('classifies malformed configuration before accessing storage', async () => {
    state.storage.mockImplementation(() => { throw new Error('Durable KV configuration invalid: pair missing.'); });
    expect(await (await GET()).json()).toEqual({ error: 'REDIS_CONFIGURATION_INVALID' });
    expect(state.credits).not.toHaveBeenCalled();
  });
});