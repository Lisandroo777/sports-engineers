import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ evaluate: vi.fn(), configured: vi.fn() }));
vi.mock('@/lib/storage/kv', () => ({ getDurableKVStatus: mocks.configured, kvEval: mocks.evaluate }));
vi.mock('@/lib/odds/persistentCache', () => ({ readCreditStatus: async () => ({ remaining: '16000' }) }));
vi.mock('@/lib/odds/budget', () => ({ getOddsBudgetStatus: async () => ({ belowReserve: false }) }));
vi.mock('@/lib/odds/autoRefreshLedger', () => ({
  dailyLedgerKey: () => 'day:fixture', isAutomaticOddsRefreshEnabled: () => true,
  getOddsRefreshLimits: () => ({ perSearchCredits: 50, dailyCredits: 300, minProviderRemaining: 2000, requestsPerMinute: 10 }),
}));
import { GET } from './route';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.configured.mockReturnValue({ configured: true });
  mocks.evaluate.mockResolvedValue(['16000', '990', '0', '100', 1000]);
});

describe('read-only automatic refresh preflight', () => {
  it('does not read the ledger unless explicitly requested', async () => {
    expect((await GET()).status).toBe(200);
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });

  it('checks a full 50-credit allowance without reserving or spending', async () => {
    const response = await GET(new Request('https://fixture/api/odds/cache/status?refreshPreflight=1'));
    expect((await response.json()).refreshPreflight).toMatchObject({ allowed: true, dailySpent: 100,
      pendingCredits: 0, requestedCredits: 50, dailyAvailable: 200, balanceCurrent: true });
    const [script] = mocks.evaluate.mock.calls[0];
    expect(script).not.toMatch(/HSET|HINCRBY|SET\b|DEL\b/);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it.each([
    ['16000', '990', '1', '250', 1000],
    ['2049', '990', '0', '0', 1000],
    ['16000', '600', '0', '0', 1000],
    ['-1', '990', '0', '0', 1000],
  ])('fails closed when balance, reserve, or daily allowance is insufficient', async (...values) => {
    mocks.evaluate.mockResolvedValue(values);
    const response = await GET(new Request('https://fixture/api/odds/cache/status?refreshPreflight=1'));
    expect((await response.json()).refreshPreflight.allowed).toBe(false);
  });

  it('fails closed for malformed ledger results', async () => {
    mocks.evaluate.mockResolvedValue(['bad']);
    expect((await GET(new Request('https://fixture/api/odds/cache/status?refreshPreflight=1'))).status).toBe(503);
  });
});