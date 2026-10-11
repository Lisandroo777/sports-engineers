import { afterEach, describe, expect, it } from 'vitest';
import { createLedgerAccessSession, gradingAuthorized, isLedgerReadAuthorized, ledgerAccessCookie, signPresentationReceipt, verifyPresentationReceipt } from './security';

afterEach(() => { delete process.env.NFL_LEDGER_RECEIPT_SECRET; delete process.env.NFL_LEDGER_VIEW_SECRET; delete process.env.NFL_LEDGER_SESSION_SECRET; delete process.env.NFL_LEDGER_GRADE_SECRET; });

describe('NFL ledger access and receipt security', () => {
  it('rejects missing, tampered and expired signed presentation receipts', () => {
    const now = Date.parse('2026-10-07T12:00:00Z');
    process.env.NFL_LEDGER_RECEIPT_SECRET = 'receipt-secret';
    const token = signPresentationReceipt({ issuedAt: new Date(now).toISOString(), researchSessionId: 's', rankingIntent: 'BEST', researchMode: 'STANDARD', rows: [] }, now);
    expect(verifyPresentationReceipt(token, now)).not.toBeNull();
    expect(verifyPresentationReceipt(`${token.slice(0, -1)}x`, now)).toBeNull();
    expect(verifyPresentationReceipt(token, now + 21 * 60 * 1000)).toBeNull();
    delete process.env.NFL_LEDGER_RECEIPT_SECRET;
    expect(verifyPresentationReceipt(token, now)).toBeNull();
  });

  it('requires a separate shared-secret exchange and signed cookie for reads', () => {
    process.env.NFL_LEDGER_VIEW_SECRET = 'view-secret';
    process.env.NFL_LEDGER_SESSION_SECRET = 'session-secret';
    const token = createLedgerAccessSession('view-secret', 1000)!;
    const cookie = ledgerAccessCookie(token, true);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(isLedgerReadAuthorized(`other=1; ${cookie.split(';')[0]}`, 2000)).toBe(true);
    expect(isLedgerReadAuthorized(null, 2000)).toBe(false);
    expect(isLedgerReadAuthorized(`${cookie.split(';')[0]}tampered`, 2000)).toBe(false);
    expect(isLedgerReadAuthorized(cookie.split(';')[0], 1000 + 13 * 60 * 60 * 1000)).toBe(false);
  });

  it('protects grading with an independent bearer secret', () => {
    process.env.NFL_LEDGER_GRADE_SECRET = 'grade-secret';
    expect(gradingAuthorized('Bearer grade-secret')).toBe(true);
    expect(gradingAuthorized('Bearer wrong')).toBe(false);
    expect(gradingAuthorized(null)).toBe(false);
  });
});
