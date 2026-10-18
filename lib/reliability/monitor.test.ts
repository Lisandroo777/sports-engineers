import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const kv = vi.hoisted(() => ({ hasDurableKV: vi.fn(), kvEval: vi.fn(), kvGetJson: vi.fn() }));
vi.mock('../storage/kv', () => kv);

let monitor: typeof import('./monitor');
const input = { sport: 'nfl', status: 'NO_QUALIFYING_PICKS', researchComplete: true, resultsCount: 0, durationMs: 123 };

beforeEach(async () => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-18T12:30:00Z'));
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected network call'); }));
  kv.hasDurableKV.mockReturnValue(true);
  kv.kvEval.mockResolvedValue(1);
  kv.kvGetJson.mockResolvedValue(null);
  monitor = await import('./monitor');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function storedObservation(call = 0) {
  return JSON.parse(kv.kvEval.mock.calls[call][2][0]);
}

function serveRecorded(call = 0) {
  const [ , keys, args] = kv.kvEval.mock.calls[call];
  kv.kvGetJson.mockImplementation(async (key: string) => key === keys[0]
    ? { hours: { [args[1]]: JSON.parse(args[0]) } } : null);
}

describe('research outcome telemetry', () => {
  it('records completion with zero qualifying picks using exactly one atomic, expiring write', async () => {
    await expect(monitor.recordResearchOutcome(input)).resolves.toBe(true);
    expect(kv.kvEval).toHaveBeenCalledTimes(1);
    const [script, keys, args] = kv.kvEval.mock.calls[0];
    expect(keys).toEqual(['research-health:v1:nfl:2026-10-18']);
    expect(args[2]).toBe(604800);
    expect(script).toContain("redis.call('SET', KEYS[1], cjson.encode(bucket), 'EX', ARGV[3])");
    expect(storedObservation()).toMatchObject({ requests: 1, complete: 1, partial: 0, failed: 0, withPicks: 0, durationTotal: 123 });
    serveRecorded();
    const health = await monitor.readResearchHealth();
    expect(health.sports.nfl).toMatchObject({ status: 'observed', durability: 'durable', requests: 1, complete: 1, completionRate: 1, withPicks: 0, lastDuration: 123 });
    expect(fetch).not.toHaveBeenCalled();
    expect(health.zeroOddsCalls).toBe(true);
  });

  it('whitelists all persisted and logged fields, including sport and status', async () => {
    const secret = 'https://secret.test/?token=private-player-session';
    await monitor.recordResearchOutcome({ ...input, sport: secret, status: secret, query: secret, playerId: secret, sessionId: secret, error: secret } as typeof input);
    expect(kv.kvEval.mock.calls[0][1]).toEqual(['research-health:v1:unknown:2026-10-18']);
    expect(storedObservation()).toMatchObject({ complete: 0, failed: 1, lastOutcome: 'ERROR' });
    expect(JSON.stringify(kv.kvEval.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(vi.mocked(console.info).mock.calls)).not.toContain(secret);
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(secret);
    expect(Object.keys(storedObservation()).sort()).toEqual(['requests', 'complete', 'partial', 'failed', 'withPicks', 'resultsCount', 'gamesFound', 'gamesScheduled', 'durationTotal', 'lastAt', 'lastDuration', 'lastOutcome'].sort());
  });

  it('bounds invalid numeric inputs without coercing strings or non-finite numbers', async () => {
    await monitor.recordResearchOutcome({ ...input, resultsCount: Infinity, gamesFound: -10, gamesScheduled: NaN, durationMs: Infinity });
    expect(storedObservation()).toMatchObject({ resultsCount: 0, gamesFound: 0, gamesScheduled: 0, durationTotal: 0 });
    await monitor.recordResearchOutcome({ ...input, resultsCount: 1e30, gamesFound: 1e30, gamesScheduled: 12.9, durationMs: 1e30 });
    expect(storedObservation(1)).toMatchObject({ resultsCount: 1_000_000, gamesFound: 100_000, gamesScheduled: 12, durationTotal: 86_400_000 });
  });

  it('tracks partial coverage separately from complete research', async () => {
    await monitor.recordResearchOutcome({ ...input, status: 'PARTIAL', partialCoverage: true, resultsCount: 3 });
    expect(storedObservation()).toMatchObject({ complete: 0, partial: 1, failed: 0, withPicks: 1 });
  });

  it.each(['NO_ELITE_RESULTS', 'SLATE_COMPLETE', 'NO_CANDIDATES'])('recognizes completed %s research without requiring picks', async (status) => {
    await monitor.recordResearchOutcome({ ...input, status });
    expect(storedObservation()).toMatchObject({ complete: 1, failed: 0, withPicks: 0, lastOutcome: status });
  });

  it.each(['PROVIDER_ERROR', 'RESEARCH_INCOMPLETE'])('does not count %s as complete even if an inconsistent flag is supplied', async (status) => {
    await monitor.recordResearchOutcome({ ...input, status });
    expect(storedObservation()).toMatchObject({ complete: 0, failed: 1, lastOutcome: status });
  });

  it('reads persisted observations after process memory has been discarded', async () => {
    await monitor.recordResearchOutcome(input);
    serveRecorded();
    vi.resetModules();
    const fresh = await import('./monitor');
    expect((await fresh.readResearchHealth()).sports.nfl).toMatchObject({ status: 'observed', requests: 1, completionRate: 1 });
  });

  it('reports absent Redis as process-local, unknown health, and a failed durable receipt', async () => {
    kv.hasDurableKV.mockReturnValue(false);
    await expect(monitor.recordResearchOutcome(input)).resolves.toBe(false);
    const health = await monitor.readResearchHealth();
    expect(health.sports.nfl).toMatchObject({ status: 'unknown', durability: 'process-local', receiptError: 'NOT_CONFIGURED', requests: 1 });
    expect(health.sports.mlb).toMatchObject({ status: 'unknown', durability: 'unavailable', requests: 0, lastAt: null, completionRate: null });
    expect(kv.kvEval).not.toHaveBeenCalled();
    expect(kv.kvGetJson).not.toHaveBeenCalled();
  });

  it('never retries an ambiguous write failure or exposes the raw error', async () => {
    kv.kvEval.mockRejectedValue(new Error('private-token query player url'));
    await expect(monitor.recordResearchOutcome(input)).resolves.toBe(false);
    expect(kv.kvEval).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith('[research-health]', JSON.stringify({ sport: 'nfl', status: 'NO_QUALIFYING_PICKS', category: 'WRITE_FAILED' }));
    const health = await monitor.readResearchHealth();
    expect(health.sports.nfl).toMatchObject({ status: 'unknown', receiptError: 'WRITE_FAILED' });
    expect(JSON.stringify(health)).not.toContain('private-token');
  });

  it('handles configuration and read failures without rejecting health reads', async () => {
    kv.hasDurableKV.mockImplementation(() => { throw new Error('secret config'); });
    await expect(monitor.recordResearchOutcome(input)).resolves.toBe(false);
    expect((await monitor.readResearchHealth()).sports.nfl).toMatchObject({ status: 'unknown', receiptError: 'CONFIGURATION_ERROR' });
    kv.hasDurableKV.mockReturnValue(true);
    kv.kvGetJson.mockRejectedValue(new Error('secret provider response'));
    const health = await monitor.readResearchHealth();
    expect(health.sports.nfl).toMatchObject({ status: 'unknown', durability: 'process-local', receiptError: 'READ_FAILED', requests: 1 });
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('secret');
  });

  it('does not infer live health from configuration or a check timestamp', async () => {
    const health = await monitor.readResearchHealth();
    expect(health.checkedAt).toBe(Date.now());
    for (const summary of Object.values(health.sports)) {
      expect(summary).toMatchObject({ status: 'unknown', durability: 'durable', requests: 0, lastAt: null, lastOutcome: null, completionRate: null });
    }
    expect(kv.kvGetJson).toHaveBeenCalledTimes(10);
    expect(kv.kvEval).not.toHaveBeenCalled();
  });

  it('aggregates yesterday and today, sanitizing stored values and excluding expired observations', async () => {
    await monitor.recordResearchOutcome(input);
    const base = storedObservation();
    const hour = (date: string) => Date.parse(date);
    kv.kvGetJson.mockImplementation(async (key: string) => {
      if (key === 'research-health:v1:nfl:2026-10-17') return {
        hours: {
          [hour('2026-10-17T11:00:00Z')]: { ...base, lastAt: hour('2026-10-17T11:10:00Z') },
          [hour('2026-10-17T13:00:00Z')]: { ...base, complete: 0, failed: 1, lastAt: hour('2026-10-17T13:10:00Z') },
        },
      };
      if (key === 'research-health:v1:nfl:2026-10-18') return {
        hours: { [hour('2026-10-18T12:00:00Z')]: { ...base, private: 'secret', lastOutcome: 'secret' } },
      };
      return null;
    });
    const health = await monitor.readResearchHealth();
    expect(health.windowResolution).toBe('hour');
    expect(health.windowStart).toBe(hour('2026-10-17T12:00:00Z'));
    expect(health.sports.nfl).toMatchObject({ requests: 2, complete: 1, failed: 1, completionRate: 0.5, lastOutcome: 'ERROR' });
    expect(JSON.stringify(health)).not.toContain('secret');
  });

  it('keeps a bounded five-sport surface and expires process-local observations', async () => {
    kv.hasDurableKV.mockReturnValue(false);
    await monitor.recordResearchOutcome({ ...input, sport: { secret: 'not-a-sport' } });
    expect((await monitor.readResearchHealth()).sports.unknown.requests).toBe(1);
    vi.setSystemTime(new Date('2026-10-26T12:30:00Z'));
    await monitor.recordResearchOutcome(input);
    const health = await monitor.readResearchHealth();
    expect(Object.keys(health.sports)).toEqual(['nfl', 'mlb', 'nba', 'all', 'unknown']);
    expect(health.sports.unknown).toMatchObject({ requests: 0, status: 'unknown', lastAt: null });
  });

  it('bounds and whitelists corrupt durable data on reads', async () => {
    await monitor.recordResearchOutcome(input);
    const observation = { ...storedObservation(), requests: 2, complete: 1e30, partial: -5, failed: NaN, durationTotal: 'private-token', lastDuration: Infinity, lastOutcome: 'private-token', query: 'private-token' };
    kv.kvGetJson.mockImplementation(async (key: string) => key === 'research-health:v1:nfl:2026-10-18'
      ? { hours: { [String(Date.parse('2026-10-18T12:00:00Z'))]: observation } } : null);
    const health = await monitor.readResearchHealth();
    expect(health.sports.nfl).toMatchObject({ requests: 2, complete: 2, partial: 0, failed: 0, durationTotal: 0, lastDuration: 0, lastOutcome: 'ERROR' });
    expect(JSON.stringify(health)).not.toContain('private-token');
  });

  it('treats an unconfirmed write receipt as a failure and contains logging failures', async () => {
    kv.kvEval.mockResolvedValue(null);
    vi.mocked(console.warn).mockImplementation(() => { throw new Error('logging unavailable'); });
    await expect(monitor.recordResearchOutcome(input)).resolves.toBe(false);
    expect(kv.kvEval).toHaveBeenCalledTimes(1);
    kv.kvEval.mockResolvedValue(1);
    vi.mocked(console.info).mockImplementation(() => { throw new Error('logging unavailable'); });
    await expect(monitor.recordResearchOutcome(input)).resolves.toBe(true);
  });
});