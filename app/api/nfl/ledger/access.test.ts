import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { listMock } = vi.hoisted(() => ({ listMock: vi.fn(async () => []) }));
vi.mock('../../../../lib/nfl/predictionLedger/redisStore', () => ({ redisNFLLedgerRepository: { list: listMock } }));

import { POST } from './access/route';
import { GET } from './route';

beforeEach(() => {
  process.env.NFL_LEDGER_VIEW_SECRET = 'view-password';
  process.env.NFL_LEDGER_SESSION_SECRET = 'session-signing-key';
  listMock.mockResolvedValue([]);
});
afterEach(() => { delete process.env.NFL_LEDGER_VIEW_SECRET; delete process.env.NFL_LEDGER_SESSION_SECRET; vi.clearAllMocks(); });

describe('NFL performance route access', () => {
  it('keeps aggregate and recent prediction records private until access is granted', async () => {
    const denied = await GET(new Request('http://localhost/api/nfl/ledger'));
    expect(denied.status).toBe(401);
    expect(listMock).not.toHaveBeenCalled();

    const login = await POST(new Request('http://localhost/api/nfl/ledger/access', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'view-password' }) }));
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const response = await GET(new Request('http://localhost/api/nfl/ledger', { headers: { cookie } }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(await response.json()).toMatchObject({ report: { scope: 'GLOBAL', overall: { sampleSize: 0 }, sampleWarning: expect.stringContaining('Insufficient sample') }, recent: [] });
    expect(listMock).toHaveBeenCalledOnce();
  });
});
