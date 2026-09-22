import { NextResponse } from 'next/server';
import { invalidatePersistentCache } from '@/lib/odds/persistentCache';

/** Dev-only manual cache bust. Clears the persistent Odds API cache (not the credit-status ledger). */
export async function POST() {
  await invalidatePersistentCache();
  return NextResponse.json({ invalidated: true });
}
