import { NextResponse } from 'next/server';
import { createLedgerAccessSession, ledgerAccessCookie } from '../../../../../lib/nfl/predictionLedger/security';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let body: { password?: unknown };
  try { body = await request.json() as { password?: unknown }; }
  catch { return NextResponse.json({ error: 'Invalid request.' }, { status: 400 }); }
  if (typeof body.password !== 'string' || body.password.length > 512) return NextResponse.json({ error: 'Access denied.' }, { status: 401 });
  const token = createLedgerAccessSession(body.password);
  if (!token) return NextResponse.json({ error: 'Access denied.' }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  response.headers.set('set-cookie', ledgerAccessCookie(token, process.env.NODE_ENV === 'production'));
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.headers.set('set-cookie', 'deepside_nfl_ledger_access=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  return response;
}
