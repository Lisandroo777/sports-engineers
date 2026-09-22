import { readCreditStatus } from './persistentCache';

const DEFAULT_MIN_RESERVE = 50;

export function getMinCreditReserve(): number {
  const raw = process.env.ODDS_MIN_CREDIT_RESERVE;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_MIN_RESERVE;
}

export interface OddsBudgetStatus {
  remaining: number | null;
  minReserve: number;
  belowReserve: boolean;
}

/** Reads the last known credit balance from durable cache — no network call required. */
export async function getOddsBudgetStatus(): Promise<OddsBudgetStatus> {
  const status = await readCreditStatus();
  const remaining = status?.remaining != null ? Number(status.remaining) : null;
  const minReserve = getMinCreditReserve();
  return { remaining, minReserve, belowReserve: remaining != null && remaining < minReserve };
}

export class OddsBudgetGuardError extends Error {
  constructor(message = 'Odds API request blocked: remaining credits are below the configured reserve.') {
    super(message);
    this.name = 'OddsBudgetGuardError';
  }
}
