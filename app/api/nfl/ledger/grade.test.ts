import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { runMock, adjudicateMock } = vi.hoisted(() => ({ runMock: vi.fn(), adjudicateMock: vi.fn() }));
vi.mock('../../../../lib/nfl/predictionLedger/grading', () => ({ runNFLAutomaticGrading: runMock, appendOperatorDisposition: adjudicateMock }));

import { POST } from './grade/route';

beforeEach(() => {
  process.env.NFL_LEDGER_GRADE_SECRET = 'grade-secret';
  runMock.mockResolvedValue({ scanned: 0, changed: 0, unchanged: 0, pending: 0, skippedIneligible: 0, sourceErrors: [] });
  adjudicateMock.mockResolvedValue({ created: true, record: { currentGrade: 'VOID' } });
});
afterEach(() => { delete process.env.NFL_LEDGER_GRADE_SECRET; vi.clearAllMocks(); });

describe('NFL protected grading endpoint', () => {
  it('rejects absent and invalid credentials before invoking grading', async () => {
    const denied = await POST(new Request('http://localhost/api/nfl/ledger/grade', { method: 'POST', body: '{}' }));
    expect(denied.status).toBe(403);
    expect(runMock).not.toHaveBeenCalled();
    const wrong = await POST(new Request('http://localhost/api/nfl/ledger/grade', { method: 'POST', headers: { authorization: 'Bearer wrong' }, body: '{}' }));
    expect(wrong.status).toBe(403);
  });

  it('runs automatic grading and accepts audited operator disposition only after authorization', async () => {
    const response = await POST(new Request('http://localhost/api/nfl/ledger/grade', { method: 'POST', headers: { authorization: 'Bearer grade-secret', 'content-type': 'application/json' }, body: '{}' }));
    expect(response.status).toBe(200);
    expect(runMock).toHaveBeenCalledOnce();
    const disposition = await POST(new Request('http://localhost/api/nfl/ledger/grade', { method: 'POST', headers: { authorization: 'Bearer grade-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'adjudicate', predictionId: 'p1', grade: 'VOID', reason: 'Operator-confirmed sportsbook void after review.' }) }));
    expect(disposition.status).toBe(200);
    expect(adjudicateMock).toHaveBeenCalledWith({ predictionId: 'p1', grade: 'VOID', reason: 'Operator-confirmed sportsbook void after review.' });
  });
});
