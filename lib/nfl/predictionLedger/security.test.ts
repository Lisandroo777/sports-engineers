import { afterEach, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { createLedgerAccessSession, gradingAuthorized, isLedgerReadAuthorized, ledgerAccessCookie, signPresentationReceipt, verifyPresentationReceipt } from './security';

afterEach(() => { delete process.env.NFL_LEDGER_RECEIPT_SECRET; delete process.env.NFL_LEDGER_VIEW_SECRET; delete process.env.NFL_LEDGER_SESSION_SECRET; delete process.env.NFL_LEDGER_GRADE_SECRET; });

describe('NFL ledger access and receipt security', () => {
  it('round-trips a full 15-card research payload below the transport limit', () => {
    process.env.NFL_LEDGER_RECEIPT_SECRET = 'receipt-secret';
    const now = Date.now();
    const rows = Array.from({ length: 15 }, (_, index) => ({ candidate: { candidateId: `card-${index}`, research: 'Sourced research evidence and risk context. '.repeat(2200) }, kickoff: null }));
    const token = signPresentationReceipt({ issuedAt: new Date(now).toISOString(), researchSessionId: 's', rankingIntent: 'BEST', researchMode: 'STANDARD', rows }, now);
    expect(token.startsWith('z1:')).toBe(true);
    expect(token.length).toBeLessThan(200000);
    expect(verifyPresentationReceipt(token, now)?.rows).toEqual(rows);
  });

  it('continues verifying legacy receipts and bounds compressed expansion', () => {
    process.env.NFL_LEDGER_RECEIPT_SECRET = 'receipt-secret';
    const now = Date.now();
    const receipt = { version: 1, issuedAt: new Date(now).toISOString(), expiresAt: now + 60000, rows: [] };
    const sign = (payload: string) => `${payload}.${createHmac('sha256', 'receipt-secret').update(payload).digest('base64url')}`;
    expect(verifyPresentationReceipt(sign(Buffer.from(JSON.stringify(receipt)).toString('base64url')), now)).not.toBeNull();
    const oversized = `z1:${deflateSync(Buffer.from('x'.repeat(4_000_001))).toString('base64url')}`;
    expect(verifyPresentationReceipt(sign(oversized), now)).toBeNull();
  });

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
