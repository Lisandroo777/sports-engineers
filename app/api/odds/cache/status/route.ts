import { NextResponse } from 'next/server';
import { readCreditStatus } from '@/lib/odds/persistentCache';
import { getOddsBudgetStatus } from '@/lib/odds/budget';

export const revalidate = 0;

/** Dev-only status read — no network call, just reflects the last known persisted credit ledger. */
export async function GET() {
  return NextResponse.json({ credits: await readCreditStatus(), budget: await getOddsBudgetStatus() });
}
