import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ run: vi.fn(), client: vi.fn(), record: vi.fn() }));
vi.mock('../../../../lib/ai/agent/runner', () => ({
  runAgentTurn: mocks.run, toClientResult: mocks.client, crossSportScope: () => [],
  AIUnavailableError: class AIUnavailableError extends Error {},
}));
vi.mock('../../../../lib/ai/agent/sessionStore', () => ({ deleteResearchSession: vi.fn() }));
vi.mock('../../../../communication/intent', () => ({ interpretBettingIntent: vi.fn() }));
vi.mock('../../../../lib/nfl/predictionLedger/capture', () => ({ issueNFLPresentationReceipt: vi.fn() }));
vi.mock('../../../../lib/ai/sportResearchAdapters', () => ({ detectSport: () => 'mlb' }));
vi.mock('../../../../lib/reliability/monitor', () => ({ recordResearchOutcome: mocks.record }));

import { POST } from './route';
import { isPaidRefreshAllowed, withAutomaticOddsRefresh, withOneRunPaidRefresh } from '../../../../lib/odds/client';

const result = { reply: 'Cached research.', results: [], closestMisses: [], toolTrace: [],
  researchSessionId: 'fixture-session', meta: { sport: 'mlb', status: 'STALE_SPORTSBOOK_DATA', researchComplete: false,
    source: 'recorded', oddsRefresh: { refreshed: false } } };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('ODDS_ALLOW_PAID_REFRESH', 'true');
  vi.stubEnv('ODDS_AUTO_REFRESH', 'true');
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Unexpected network request'); }));
  mocks.client.mockImplementation((value) => value);
});

afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('POST chat cacheOnly opt-in', () => {
  it.each([true, false, undefined, 'true', 1, null])('restricts only literal true: %s', async (cacheOnly) => {
    mocks.run.mockImplementation(async () => {
      await Promise.resolve();
      expect(isPaidRefreshAllowed()).toBe(cacheOnly !== true);
      await withAutomaticOddsRefresh(() => withOneRunPaidRefresh(async () => {
        expect(isPaidRefreshAllowed()).toBe(cacheOnly !== true);
      }, { forceFresh: true }));
      return result;
    });
    const response = await POST(new Request('http://localhost/api/ai/chat', {
      method: 'POST', body: JSON.stringify({ cacheOnly, messages: [{ role: 'user', content: 'Best MLB props' }],
        researchSessionId: 'fixture-session', context: { sport: 'mlb', date: '2026-10-18' },
        refreshApproval: { sport: 'mlb', maxCredits: 50 } }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...result, ledgerReceipt: null });
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith([{ role: 'user', content: 'Best MLB props' }],
      'fixture-session', null, { sport: 'mlb', date: '2026-10-18' });
    expect(isPaidRefreshAllowed()).toBe(true);
  });
});