import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let AutoRefreshLedgerError: typeof import('../odds/autoRefreshLedger').AutoRefreshLedgerError;
let OddsBudgetGuardError: typeof import('../odds/client').OddsBudgetGuardError;
let OddsRefreshNotAuthorizedError: typeof import('../odds/client').OddsRefreshNotAuthorizedError;
let getNFLSpendTelemetry: typeof import('./spendTelemetry').getNFLSpendTelemetry;
let withNFLSpendTelemetry: typeof import('./spendTelemetry').withNFLSpendTelemetry;
let retrieveNFLSportsbookGame: typeof import('./sportsbook').retrieveNFLSportsbookGame;

const boundary = vi.hoisted(() => ({ error: null as unknown }));

vi.mock('../odds/client', async (importOriginal) => ({
  ...await importOriginal<typeof import('../odds/client')>(),
  withBoundedOddsRequest: async (_path: string, _params: unknown, operation: () => Promise<{ data: unknown }>) => {
    if (boundary.error) throw boundary.error;
    return (await operation()).data;
  },
}));
vi.mock('../odds/persistentCache', () => ({
  readStalePersistentCache: async () => null,
  writePersistentCache: async () => {},
  writeCreditStatus: async () => {},
}));
vi.mock('./refreshLease', () => ({
  withNFLRefreshLease: async (_key: string, operation: () => Promise<unknown>) => operation(),
}));

const privateMessage = 'https://private.invalid/odds?apiKey=secret-fixture&markets=private-query';
let sequence = 0;

beforeEach(async () => {
  vi.resetModules();
  ({ AutoRefreshLedgerError } = await import('../odds/autoRefreshLedger'));
  ({ OddsBudgetGuardError, OddsRefreshNotAuthorizedError } = await import('../odds/client'));
  ({ getNFLSpendTelemetry, withNFLSpendTelemetry } = await import('./spendTelemetry'));
  ({ retrieveNFLSportsbookGame } = await import('./sportsbook'));
  boundary.error = null;
  vi.stubEnv('THE_ODDS_API_KEY', 'secret-fixture');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 429 })));
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function retrieve() {
  const gameId = `refresh-blocked-game-${++sequence}`;
  return withNFLSpendTelemetry(async () => ({
    gameId,
    result: await retrieveNFLSportsbookGame({
      date: '2026-10-18', gameId, eventId: 'private-event-not-logged',
      kickoff: new Date(Date.now() + 3600000).toISOString(),
      markets: ['player_pass_yds', 'player_rush_yds'],
    }),
    telemetry: structuredClone(getNFLSpendTelemetry()),
  }), 20000);
}

describe('NFL retrieve guard logging (offline bounded-request boundary)', () => {
  it.each([
    ['REMAINING_UNKNOWN', 'CREDIT_BALANCE_UNKNOWN'],
    ['DAILY_CAP', 'DAILY_LIMIT'],
    ['RESERVE', 'RESERVE'],
    ['RATE_LIMIT', 'RATE_LIMIT'],
    ['STORAGE_UNAVAILABLE', 'REFRESH_UNAVAILABLE'],
  ] as const)('logs one safe record for wrapped %s without claiming paid spend', async (reason, failure) => {
    const error = new OddsBudgetGuardError(privateMessage);
    error.cause = new AutoRefreshLedgerError(reason);
    boundary.error = error;
    const { gameId, result, telemetry } = await retrieve();
    expect(result.failure).toBe(failure);
    expect(result.failedMarkets).toHaveLength(2);
    expect(console.info).toHaveBeenCalledExactlyOnceWith('[nfl:refresh-blocked]', { gameId, reason: failure, stage: 'paid-refresh' });
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toMatch(/secret-fixture|private-event|apiKey|private-query|private\.invalid/);
    expect(fetch).not.toHaveBeenCalled();
    expect(telemetry).toMatchObject({ providerRequestsMade: 0, paidRequestsMade: 0, creditsConsumed: 0,
      creditsSpent: 0, actualSpendKnown: true, spendBasis: 'NONE', refreshedGames: [], refreshedMarkets: [] });
  });

  it('recognizes a direct ledger guard for an unknown bootstrap balance', async () => {
    boundary.error = new AutoRefreshLedgerError('REMAINING_UNKNOWN');
    const { gameId, telemetry } = await retrieve();
    expect(console.info).toHaveBeenCalledExactlyOnceWith('[nfl:refresh-blocked]', {
      gameId, reason: 'CREDIT_BALANCE_UNKNOWN', stage: 'paid-refresh',
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(telemetry).toMatchObject({ paidRequestsMade: 0, providerRequestsMade: 0, creditsConsumed: 0 });
  });

  it('does not trust a forged ledger cause or leak the guard message', async () => {
    const error = new OddsBudgetGuardError(privateMessage);
    error.cause = { reason: privateMessage };
    boundary.error = error;
    const { gameId } = await retrieve();
    expect(console.info).toHaveBeenCalledExactlyOnceWith('[nfl:refresh-blocked]', { gameId, reason: 'RESERVE', stage: 'paid-refresh' });
  });

  it('logs authorization blocks without logging their raw message', async () => {
    boundary.error = new OddsRefreshNotAuthorizedError(privateMessage);
    const { gameId, telemetry } = await retrieve();
    expect(console.info).toHaveBeenCalledExactlyOnceWith('[nfl:refresh-blocked]', {
      gameId, reason: 'REFRESH_NOT_AUTHORIZED', stage: 'paid-refresh',
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(telemetry).toMatchObject({ paidRequestsMade: 0, creditsConsumed: 0 });
  });

  it('does not label an actual provider rate limit as a guard block', async () => {
    const { result, telemetry } = await retrieve();
    expect(result.failure).toBe('RATE_LIMIT');
    expect(console.info).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(telemetry).toMatchObject({ paidRequestsMade: 1, providerRequestsMade: 1 });
  });

  it('does not label an untyped error with guard-like text as a guard block', async () => {
    boundary.error = new Error(`REMAINING_UNKNOWN ${privateMessage}`);
    const { result } = await retrieve();
    expect(result.failure).toBe('NETWORK');
    expect(console.info).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});