import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  run: vi.fn(), client: vi.fn(), record: vi.fn(), receipt: vi.fn(), intent: vi.fn(), remove: vi.fn(),
}));

vi.mock('../../../../lib/ai/agent/runner', async () => {
  const { detectSport } = await import('../../../../lib/ai/sportResearchAdapters');
  return {
    runAgentTurn: mocks.run, toClientResult: mocks.client,
    crossSportScope: (query: string) => /\ball sports\b/i.test(query) ? ['nfl', 'nba', 'mlb']
      : !detectSport(query) && /\bbest picks\b/i.test(query) ? ['nfl', 'nba', 'mlb'] : [],
    AIUnavailableError: class AIUnavailableError extends Error {},
  };
});
vi.mock('../../../../lib/reliability/monitor', () => ({ recordResearchOutcome: mocks.record }));
vi.mock('../../../../lib/nfl/predictionLedger/capture', () => ({ issueNFLPresentationReceipt: mocks.receipt }));
vi.mock('../../../../communication/intent', () => ({ interpretBettingIntent: mocks.intent }));
vi.mock('../../../../lib/ai/agent/sessionStore', () => ({ deleteResearchSession: mocks.remove }));

import { DELETE, POST } from './route';
import { AIUnavailableError } from '../../../../lib/ai/agent/runner';

const privateText = 'private-user-query token=secret-provider-key';
const sessionId = 'private-session-id';
const allowedFields = ['sport', 'status', 'researchComplete', 'partialCoverage', 'resultsCount', 'gamesFound', 'gamesScheduled', 'durationMs'];

function request(message = `Best MLB plays ${privateText}`, context?: unknown) {
  return new Request('http://localhost/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: message }], researchSessionId: sessionId, context,
      refreshApproval: { sport: 'mlb', maxCredits: 1000000 } }) });
}

function result(meta: Record<string, unknown> | null = { sport: 'mlb', status: 'SUCCESS', researchComplete: true }, results: unknown[] = []) {
  return { reply: 'Research complete.', results, closestMisses: [], toolTrace: [], researchSessionId: sessionId, meta };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(Date, 'now').mockReturnValue(1000);
  mocks.run.mockResolvedValue(result());
  mocks.client.mockImplementation((value) => value);
  mocks.record.mockResolvedValue(true);
  mocks.receipt.mockResolvedValue('unchanged-ledger-receipt');
  mocks.intent.mockReturnValue({ rankingIntent: 'BEST' });
});

afterEach(() => {
  for (const [observation] of mocks.record.mock.calls) {
    expect(Object.keys(observation).every((field) => allowedFields.includes(field))).toBe(true);
    expect(['nfl', 'nba', 'mlb', 'all', 'unknown']).toContain(observation.sport);
    expect(JSON.stringify(observation)).not.toMatch(/private-user-query|private-session-id|secret-provider-key|raw-provider-error/);
  }
  expect(JSON.stringify([...vi.mocked(console.error).mock.calls, ...vi.mocked(console.warn).mock.calls,
    ...vi.mocked(console.info).mock.calls])).not.toMatch(/private-user-query|private-session-id|secret-provider-key|raw-provider-error/);
  vi.restoreAllMocks();
});

describe('chat research reliability observations', () => {
  it('records once from the client result after issuing the existing NFL receipt', async () => {
    const client = result({ sport: 'nfl', status: 'PARTIAL', researchComplete: false, partialCoverage: true,
      gamesFound: 2, gamesScheduled: 3, nflLedger: { failedGames: 1 }, rawError: privateText }, [{ player: 'Fixture' }]);
    mocks.client.mockReturnValue(client);
    mocks.receipt.mockImplementation(async () => {
      expect(mocks.record).not.toHaveBeenCalled();
      vi.mocked(Date.now).mockReturnValue(1250);
      return 'unchanged-ledger-receipt';
    });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...client, ledgerReceipt: 'unchanged-ledger-receipt' });
    expect(mocks.receipt).toHaveBeenCalledExactlyOnceWith({ results: client.results, meta: client.meta,
      researchSessionId: sessionId, rankingIntent: 'BEST' });
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith({ sport: 'nfl', status: 'PARTIAL', researchComplete: false,
      partialCoverage: true, resultsCount: 1, gamesFound: 2, gamesScheduled: 3, durationMs: 250 });
    expect(mocks.run).toHaveBeenCalledWith(expect.any(Array), sessionId, null, undefined);
  });

  it('awaits best-effort recording and preserves successful research when the monitor rejects', async () => {
    let rejectRecord!: (reason: Error) => void;
    mocks.record.mockReturnValue(new Promise((_resolve, reject) => { rejectRecord = reject; }));
    let finished = false;
    const pending = POST(request()).then((response) => { finished = true; return response; });
    await vi.waitFor(() => expect(mocks.record).toHaveBeenCalledTimes(1));
    expect(finished).toBe(false);
    rejectRecord(new Error(`raw-provider-error ${privateText}`));
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...result(), ledgerReceipt: null });
    expect(mocks.record).toHaveBeenCalledTimes(1);
  });

  it.each(['SUCCESS', 'PARTIAL', 'NO_QUALIFYING_PICKS', 'SPORTSBOOK_DATA_REQUIRED', 'PAID_REFRESH_NOT_AUTHORIZED',
    'RESEARCH_INCOMPLETE', 'PROVIDER_ERROR', 'NO_GAMES_SCHEDULED', 'STALE_SPORTSBOOK_DATA'])('preserves client status %s without forwarding provider details', async (status) => {
    mocks.client.mockReturnValue(result({ sport: 'all', status, researchComplete: status === 'SUCCESS',
      partialCoverage: status === 'PARTIAL', gamesFound: 4, gamesScheduled: 5,
      oddsRefresh: { headers: { authorization: privateText }, refreshed: true }, providerError: privateText }));
    expect((await POST(request())).status).toBe(200);
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith({ sport: 'all', status, researchComplete: status === 'SUCCESS',
      partialCoverage: status === 'PARTIAL', resultsCount: 0, gamesFound: 4, gamesScheduled: 5, durationMs: 0 });
  });

  it('counts completed research with zero qualifying picks as success, including a refresh', async () => {
    mocks.run.mockResolvedValue(result({ sport: 'mlb', researchComplete: true, gamesFound: 3,
      oddsRefresh: { refreshed: true, headers: { 'x-requests-used': '42', authorization: privateText } } }));
    expect((await POST(request())).status).toBe(200);
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith({ sport: 'mlb', status: 'SUCCESS', researchComplete: true,
      partialCoverage: false, resultsCount: 0, gamesFound: 3, gamesScheduled: undefined, durationMs: 0 });
  });

  it('derives partial coverage from failed ledger games without changing the client status', async () => {
    mocks.run.mockResolvedValue(result({ sport: 'nfl', status: 'SUCCESS', researchComplete: true, nflLedger: { failedGames: 2 } }));
    await POST(request());
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ sport: 'nfl', status: 'SUCCESS', partialCoverage: true }));
  });

  it('does not pass arbitrary metadata strings or non-numeric counts to the monitor', async () => {
    mocks.run.mockResolvedValue(result({ sport: privateText, status: privateText, gamesFound: privateText,
      gamesScheduled: privateText, researchComplete: privateText, partialCoverage: privateText }));
    await POST(request());
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith({ sport: 'mlb', status: 'RESEARCH_INCOMPLETE', researchComplete: false,
      partialCoverage: false, resultsCount: 0, gamesFound: undefined, gamesScheduled: undefined, durationMs: 0 });
  });

  it.each([
    ['Best NFL props', undefined, 'nfl'], ['Best NBA props', undefined, 'nba'],
    ['Continue research', { sport: 'mlb', date: '2026-10-18' }, 'mlb'],
    ['Best picks across all sports', undefined, 'all'], ['Continue research', { sport: privateText }, 'unknown'],
  ])('uses only enumerated request sport on failures: %s', async (message, context, sport) => {
    mocks.run.mockRejectedValue(new Error(`raw-provider-error ${privateText}`));
    mocks.record.mockRejectedValue(new Error(privateText));
    const response = await POST(request(message, context));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'The research agent failed to complete this request.', code: 'PROVIDER_ERROR' });
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith({ sport, status: 'PROVIDER_ERROR', researchComplete: false,
      partialCoverage: false, resultsCount: 0, durationMs: 0 });
  });

  it('records AI unavailability with a fixed safe 503 response even if monitoring fails', async () => {
    mocks.run.mockRejectedValue(new AIUnavailableError(`raw-provider-error ${privateText}`));
    mocks.record.mockRejectedValue(new Error(privateText));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'The research agent is currently unavailable.', code: 'AI_UNAVAILABLE' });
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith({ sport: 'mlb', status: 'UNAVAILABLE', researchComplete: false,
      partialCoverage: false, resultsCount: 0, durationMs: 0 });
  });

  it('records conversion failures as safe API failures', async () => {
    mocks.client.mockImplementation(() => { throw new Error(`raw-provider-error ${privateText}`); });
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'PROVIDER_ERROR', resultsCount: 0 }));
  });

  it('records only a failure if the client response cannot be serialized', async () => {
    mocks.client.mockReturnValue({ ...result(), unserializable: BigInt(1) });
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'The research agent failed to complete this request.', code: 'PROVIDER_ERROR' });
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ status: 'PROVIDER_ERROR', resultsCount: 0 }));
  });

  it('preserves receipt failure behavior and still records research once', async () => {
    const client = result({ sport: 'nfl', status: 'SUCCESS', researchComplete: true }, [{ player: 'Fixture' }]);
    mocks.run.mockResolvedValue(client);
    mocks.receipt.mockRejectedValue(new Error(`raw-provider-error ${privateText}`));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ...client, ledgerReceipt: null });
    expect(mocks.receipt).toHaveBeenCalledTimes(1);
    expect(mocks.record).toHaveBeenCalledTimes(1);
  });

  it('leaves invalid requests and DELETE outside research observation', async () => {
    const invalid = await POST(new Request('http://localhost/api/ai/chat', { method: 'POST', body: '{' }));
    expect(invalid.status).toBe(400);
    const empty = await POST(new Request('http://localhost/api/ai/chat', { method: 'POST', body: JSON.stringify({ messages: [] }) }));
    expect(empty.status).toBe(400);
    const deleted = await DELETE(request());
    expect(await deleted.json()).toEqual({ ok: true });
    expect(mocks.remove).toHaveBeenCalledExactlyOnceWith(sessionId);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(mocks.receipt).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });
});