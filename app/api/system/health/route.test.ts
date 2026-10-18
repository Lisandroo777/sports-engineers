import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authorized: vi.fn(), durable: vi.fn(), get: vi.fn(), credits: vi.fn(), monitor: vi.fn(), limits: vi.fn(), enabled: vi.fn(),
}));
vi.mock('../../../../lib/nfl/predictionLedger/security', () => ({ isLedgerReadAuthorized: mocks.authorized }));
vi.mock('../../../../lib/storage/kv', () => ({ getDurableKVStatus: mocks.durable, kvGetJson: mocks.get }));
vi.mock('../../../../lib/odds/persistentCache', () => ({ readCreditStatus: mocks.credits }));
vi.mock('../../../../lib/odds/autoRefreshLedger', () => ({ getOddsRefreshLimits: mocks.limits, isAutomaticOddsRefreshEnabled: mocks.enabled }));
vi.mock('../../../../lib/reliability/monitor', () => ({ readResearchHealth: mocks.monitor }));
import { GET } from './route';

beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllEnvs();
  mocks.authorized.mockReturnValue(true);
  mocks.durable.mockReturnValue({ configured: true });
  mocks.get.mockResolvedValue(null);
  mocks.credits.mockResolvedValue(null);
  mocks.monitor.mockResolvedValue({});
  mocks.enabled.mockReturnValue(false);
  mocks.limits.mockReturnValue({ perSearchCredits: 50, dailyCredits: 300, minProviderRemaining: 2000, requestsPerMinute: 10 });
});

describe('private system health', () => {
  it.each(['production', 'development'])('requires cookie auth before every read in %s, ignoring trusted-looking headers', async environment => {
    vi.stubEnv('NODE_ENV', environment);
    mocks.authorized.mockReturnValue(false);
    const response = await GET(new Request('http://localhost/api/system/health', { headers: { 'x-vercel-id': 'trusted', 'x-vercel-protection-bypass': 'spoofed', 'x-forwarded-host': 'localhost' } }));
    expect(response.status).toBe(401);
    expect(mocks.authorized).toHaveBeenCalledWith(null);
    for (const mock of [mocks.durable, mocks.get, mocks.credits, mocks.monitor, mocks.limits, mocks.enabled]) expect(mock).not.toHaveBeenCalled();
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('only probes Redis with a GET and never equates key presence with provider health', async () => {
    vi.stubEnv('THE_ODDS_API_KEY', 'private-odds-value');
    vi.stubEnv('OPENAI_API_KEY', 'private-openai-value');
    const response = await GET(new Request('https://local/api/system/health', { headers: { cookie: 'session=value' } }));
    const body = await response.json();
    expect(mocks.authorized).toHaveBeenCalledWith('session=value');
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith('deepside:system-health:read-only-sentinel');
    expect(body.durable.state).toBe('HEALTHY');
    expect(body.providers.odds).toEqual({ state: 'CONFIGURED', configured: true, authorization: 'UNKNOWN' });
    expect(body.providers.openai.state).toBe('CONFIGURED');
    expect(body.state).toBe('UNKNOWN');
    expect(JSON.stringify(body)).not.toContain('private-');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('labels old cached credits STALE with UNKNOWN health', async () => {
    mocks.credits.mockResolvedValue({ remaining: '3100', updatedAt: Date.now() - 301_000, path: 'secret-url' });
    const body = await (await GET(new Request('http://local/api/system/health'))).json();
    expect(body.credits).toMatchObject({ state: 'UNKNOWN', freshness: 'STALE', balance: 3100 });
    expect(body.credits.ageMs).toBeGreaterThan(300_000);
    expect(JSON.stringify(body)).not.toContain('secret-url');
  });

  it('isolates failed reads and never returns raw errors', async () => {
    mocks.get.mockRejectedValue(new Error('secret redis endpoint'));
    mocks.monitor.mockRejectedValue(new Error('secret monitoring error'));
    mocks.limits.mockImplementation(() => { throw new Error('secret invalid setting'); });
    mocks.credits.mockResolvedValue({ remaining: '3000', updatedAt: Date.now() - 1000 });
    const body = await (await GET(new Request('http://local/api/system/health'))).json();
    expect(body.state).toBe('DEGRADED');
    expect(body.durable.state).toBe('DOWN');
    expect(body.monitoring.state).toBe('DEGRADED');
    expect(body.credits.balance).toBe(3000);
    expect(body.healthReadErrors).toEqual(['durable', 'refreshLimits', 'monitoring']);
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('reports missing credentials and unobserved sports without health claims', async () => {
    vi.stubEnv('THE_ODDS_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');
    mocks.durable.mockReturnValue({ configured: false });
    mocks.monitor.mockResolvedValue({ sports: { NFL: { state: 'HEALTHY' } } });
    const body = await (await GET(new Request('http://local/api/system/health'))).json();
    expect(body.providers.odds.state).toBe('NOT_CONFIGURED');
    expect(body.durable.state).toBe('NOT_CONFIGURED');
    expect(mocks.get).not.toHaveBeenCalled();
    expect(body.monitoring.sports.every((sport: { state: string }) => sport.state === 'UNKNOWN')).toBe(true);
  });

  it('maps the shared monitoring contract to recorded observations without exposing extra fields', async () => {
    const lastAt = Date.now() - 60_000;
    mocks.monitor.mockResolvedValue({ sports: {
      nfl: { status: 'observed', durability: 'durable', receiptError: null, lastAt, requests: 10, complete: 8, partial: 1, failed: 1, completionRate: .8, lastOutcome: 'NO_QUALIFYING_PICKS', debug: 'secret' },
      mlb: { status: 'unknown', durability: 'process-local', receiptError: 'READ_FAILED', lastAt, requests: 1, complete: 1, completionRate: 1, lastOutcome: 'COMPLETE' },
    } });
    const body = await (await GET(new Request('http://local/api/system/health'))).json();
    expect(body.monitoring.sports[0]).toMatchObject({ sport: 'NFL', state: 'DEGRADED', observedAt: lastAt, total: 10, complete: 8, partial: 1, failed: 1, completeRate: .8, lastOutcome: 'NO_QUALIFYING_PICKS', durability: 'durable' });
    expect(body.monitoring.sports[1]).toMatchObject({ sport: 'MLB', state: 'DEGRADED', durability: 'process-local' });
    expect(body.state).toBe('DEGRADED');
    expect(body.healthReadErrors).toEqual(['monitoring']);
    expect(JSON.stringify(body)).not.toContain('secret');
  });

  it('isolates credit read errors and rejects malformed or future timestamps', async () => {
    mocks.credits.mockRejectedValue(new Error('private credit read error'));
    let body = await (await GET(new Request('http://local/api/system/health'))).json();
    expect(body.healthReadErrors).toEqual(['credits']);
    expect(body.credits).toMatchObject({ state: 'UNKNOWN', freshness: 'UNKNOWN', balance: null });
    mocks.credits.mockResolvedValue({ remaining: 'invalid', updatedAt: Date.now() + 60_000 });
    body = await (await GET(new Request('http://local/api/system/health'))).json();
    expect(body.credits).toMatchObject({ state: 'UNKNOWN', freshness: 'UNKNOWN', balance: null, observedAt: null });
  });
});