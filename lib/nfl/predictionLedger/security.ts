import { createHmac, timingSafeEqual } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';

const ACCESS_COOKIE = 'deepside_nfl_ledger_access';
const RECEIPT_TTL_MS = 20 * 60 * 1000;
const ACCESS_TTL_MS = 12 * 60 * 60 * 1000;

type ReceiptRow = {
  candidate: Record<string, unknown>;
  kickoff: { time: string; source: string } | null;
};

export interface NFLPresentationReceipt {
  version: 1;
  issuedAt: string;
  expiresAt: number;
  researchSessionId: string | null;
  rankingIntent: 'BEST' | 'MOST_LIKELY' | 'BEST_VALUE';
  researchMode: 'STANDARD' | 'DEEP';
  rows: ReceiptRow[];
}

function secret(name: string): string | null {
  return process.env[name]?.trim() || null;
}

function signature(payload: string, key: string): string {
  return createHmac('sha256', key).update(payload).digest('base64url');
}

function safeEqual(first: string, second: string): boolean {
  const a = Buffer.from(first);
  const b = Buffer.from(second);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signPresentationReceipt(input: Omit<NFLPresentationReceipt, 'version' | 'expiresAt'>, now = Date.now()): string {
  const key = secret('NFL_LEDGER_RECEIPT_SECRET');
  if (!key) throw new Error('NFL ledger presentation receipt secret is not configured.');
  const receipt: NFLPresentationReceipt = { ...input, version: 1, expiresAt: now + RECEIPT_TTL_MS };
  const payload = `z1:${deflateSync(Buffer.from(JSON.stringify(receipt))).toString('base64url')}`;
  if (payload.length + 44 > 200_000) throw new Error('NFL presentation receipt exceeds the signed payload limit.');
  return `${payload}.${signature(payload, key)}`;
}

export function verifyPresentationReceipt(token: string, now = Date.now()): NFLPresentationReceipt | null {
  const key = secret('NFL_LEDGER_RECEIPT_SECRET');
  if (!key || token.length > 200_000) return null;
  const [payload, supplied, extra] = token.split('.');
  if (!payload || !supplied || extra != null || !safeEqual(signature(payload, key), supplied)) return null;
  try {
    const decoded = payload.startsWith('z1:')
      ? inflateSync(Buffer.from(payload.slice(3), 'base64url'), { maxOutputLength: 4_000_000 })
      : Buffer.from(payload, 'base64url');
    const receipt = JSON.parse(decoded.toString('utf8')) as NFLPresentationReceipt;
    if (receipt.version !== 1 || !Array.isArray(receipt.rows) || receipt.expiresAt < now || !Number.isFinite(Date.parse(receipt.issuedAt))) return null;
    return receipt;
  } catch { return null; }
}

export function createLedgerAccessSession(password: string, now = Date.now()): string | null {
  const expected = secret('NFL_LEDGER_VIEW_SECRET');
  const signingKey = secret('NFL_LEDGER_SESSION_SECRET');
  if (!expected || !signingKey || !safeEqual(password, expected)) return null;
  const payload = Buffer.from(JSON.stringify({ issuedAt: now, expiresAt: now + ACCESS_TTL_MS })).toString('base64url');
  return `${payload}.${signature(payload, signingKey)}`;
}

export function isLedgerReadAuthorized(cookieHeader: string | null, now = Date.now()): boolean {
  const token = cookieHeader?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${ACCESS_COOKIE}=`))?.slice(ACCESS_COOKIE.length + 1);
  const key = secret('NFL_LEDGER_SESSION_SECRET');
  if (!token || !key) return false;
  const [payload, supplied, extra] = token.split('.');
  if (!payload || !supplied || extra != null || !safeEqual(signature(payload, key), supplied)) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { expiresAt?: number };
    return Number.isFinite(session.expiresAt) && session.expiresAt! > now;
  } catch { return false; }
}

export function ledgerAccessCookie(token: string, secure: boolean): string {
  return `${ACCESS_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${ACCESS_TTL_MS / 1000}${secure ? '; Secure' : ''}`;
}

export function gradingAuthorized(authorization: string | null): boolean {
  const expected = secret('NFL_LEDGER_GRADE_SECRET');
  const supplied = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
  return !!expected && !!supplied && safeEqual(supplied, expected);
}
