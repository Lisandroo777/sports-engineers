import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ResearchSession } from '../ai/agent/session';

const state = vi.hoisted(() => ({ socket: '', cli: '', available: true }));
vi.mock('../storage/kv', () => ({
  hasDurableKV: () => state.available,
  allowLocalPersistenceFallback: () => false,
  kvGetJson: async (key: string) => {
    const value = await command('GET', key);
    return value == null ? null : JSON.parse(value);
  },
  kvSetJson: async (key: string, value: unknown, ttlMs?: number) => {
    await command('SET', key, JSON.stringify(value), ...(ttlMs == null ? [] : ['PX', String(Math.ceil(ttlMs))]));
  },
  kvDel: async (key: string) => { await command('DEL', key); },
  kvEval: async (script: string, keys: string[], args: Array<string | number>) => {
    const { stdout } = await promisify(execFile)(state.cli, ['-s', state.socket, '--json', 'EVAL', script, String(keys.length), ...keys, ...args.map(String)]);
    return JSON.parse(stdout);
  },
}));
import { acquireRefreshLock, dailyLedgerKey, recordProviderRemaining, releaseRefreshLock, reserveDailyCredits, settleDailyCredits } from './autoRefreshLedger';

const directory = process.env.DEEPSIDE_REDIS_TEST_DIR;
const executable = directory ? join(directory, 'redis-server') : '';
const enabled = Boolean(directory && existsSync(executable));
let server: ChildProcess;
let workingDirectory: string;
const account = 'deepside:odds:auto:v2:account';
async function command(...args: string[]) {
  const { stdout } = await promisify(execFile)(state.cli, ['-s', state.socket, '--json', ...args]);
  return JSON.parse(stdout);
}

describe.skipIf(!enabled)('actual isolated Redis Lua protections', () => {
  beforeAll(async () => {
    workingDirectory = mkdtempSync(join(tmpdir(), 'ds-redis-'));
    state.socket = join(workingDirectory, 'test.sock'); state.cli = join(directory!, 'redis-cli');
    server = spawn(executable, ['--port', '0', '--unixsocket', state.socket, '--unixsocketperm', '700', '--save', '', '--appendonly', 'no', '--dir', workingDirectory]);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Local Redis startup timed out')), 10000);
      server.once('error', reject);
      server.stdout!.on('data', output => { if (String(output).toLowerCase().includes('ready to accept connections')) { clearTimeout(timer); resolve(); } });
    });
  });
  afterAll(async () => {
    if (server) {
      const stopped = new Promise<void>(resolve => server.once('exit', () => resolve()));
      server.kill('SIGTERM'); await stopped;
    }
    if (workingDirectory) rmSync(workingDirectory, { recursive: true, force: true });
  });
  beforeEach(async () => { state.available = true; await command('FLUSHDB'); });
  afterEach(() => vi.unstubAllEnvs());

  it('persists compressed research sessions across module reloads with expiry and deletion', async () => {
    const session: ResearchSession = {
      sport: 'nfl', date: '2026-10-15', queryIntent: 'isolated persistence verification',
      generatedAt: new Date().toISOString(), candidates: [],
      toolMeta: { gamesFound: 0, gamesScheduled: 0, propsFound: 0, booksFound: 0,
        candidatesFound: 0, eliteFound: 0, cached: false, dataFreshnessSeconds: null, budgetLimited: false },
    };
    const { saveResearchSession } = await import('../ai/agent/sessionStore');
    const id = await saveResearchSession(session);
    const stored = JSON.parse(await command('GET', `ai-session:${id}`));
    expect(stored.sessionEncoding).toBe('deflate-base64-v1');
    expect(await command('PTTL', `ai-session:${id}`)).toBeGreaterThan(0);
    vi.resetModules();
    const { getResearchSession, deleteResearchSession } = await import('../ai/agent/sessionStore');
    expect(await getResearchSession(id)).toEqual(session);
    await deleteResearchSession(id);
    expect(await getResearchSession(id)).toBeNull();
    expect(await command('EXISTS', `ai-session:${id}`)).toBe(0);
  });

  it('atomically limits paid reservations per minute without debiting rejected requests', async () => {
    vi.stubEnv('ODDS_REFRESH_MAX_REQUESTS_PER_MINUTE', '2');
    await recordProviderRemaining('20000');
    const attempts = await Promise.allSettled(Array.from({ length: 5 }, () => reserveDailyCredits(1)));
    expect(attempts.filter(row => row.status === 'fulfilled')).toHaveLength(2);
    expect(attempts.filter(row => row.status === 'rejected').map(row => row.reason.reason)).toEqual(['RATE_LIMIT', 'RATE_LIMIT', 'RATE_LIMIT']);
    expect(await command('HGET', account, 'remaining')).toBe('19998');
    expect(await command('HGET', account, 'pending')).toBe('2');
  });

  it('fails closed before a valid fresh provider observation and rejects invalid bootstrap values', async () => {
    for (const value of [null, '', 'unknown', '-1', 'Infinity']) await recordProviderRemaining(value);
    await expect(reserveDailyCredits(1)).rejects.toMatchObject({ reason: 'REMAINING_UNKNOWN' });
    await recordProviderRemaining('2500');
    await expect(reserveDailyCredits(1)).resolves.toMatchObject({ credits: 1 });
    await command('HSET', account, 'observed', '1');
    await expect(reserveDailyCredits(1)).rejects.toMatchObject({ reason: 'REMAINING_UNKNOWN' });
  });

  it('never raises the conservative balance when responses arrive out of order', async () => {
    await recordProviderRemaining('2010');
    const reservation = await reserveDailyCredits(5);
    await recordProviderRemaining('2005');
    await recordProviderRemaining('2010');
    await settleDailyCredits(reservation, null);
    expect(await command('HGET', account, 'remaining')).toBe('2005');
    await expect(reserveDailyCredits(6)).rejects.toMatchObject({ reason: 'RESERVE' });
  });

  it('atomically caps simultaneous reservations across instances at 300 credits', async () => {
    await recordProviderRemaining('20000');
    const attempts = await Promise.allSettled(Array.from({ length: 20 }, () => reserveDailyCredits(50)));
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(6);
    expect(await command('HGET', account, 'pending')).toBe('300');
  });

  it('keeps uncertain charges deducted from account balance and settlement is idempotent', async () => {
    await recordProviderRemaining('2003');
    const reservation = await reserveDailyCredits(2);
    await settleDailyCredits(reservation, null);
    await settleDailyCredits(reservation, null);
    expect(await command('HGET', account, 'remaining')).toBe('2001');
    expect(await command('HGET', reservation.dayKey, 'spent')).toBe('2');
    expect(await command('HGET', account, 'pending')).toBe('0');
    await expect(reserveDailyCredits(2)).rejects.toMatchObject({ reason: 'RESERVE' });
  });

  it('carries prior-day outstanding reservations into the new day budget and reserve', async () => {
    await recordProviderRemaining('2400');
    const yesterday = new Date(Date.now() - 86400000);
    const reservations = await Promise.all(Array.from({ length: 6 }, () => reserveDailyCredits(50, yesterday)));
    await expect(reserveDailyCredits(1)).rejects.toMatchObject({ reason: 'DAILY_CAP' });
    await settleDailyCredits(reservations[0], null);
    expect(await command('HGET', dailyLedgerKey(), 'spent')).toBe('50');
    await expect(reserveDailyCredits(1)).rejects.toMatchObject({ reason: 'DAILY_CAP' });
  });

  it('allows daily rollover only after prior completed usage while retaining the account floor', async () => {
    await recordProviderRemaining('2500');
    const yesterday = dailyLedgerKey(new Date(Date.now() - 86400000));
    await command('HSET', yesterday, 'spent', '300');
    await expect(reserveDailyCredits(50)).resolves.toMatchObject({ credits: 50 });
    expect(await command('HGET', account, 'remaining')).toBe('2450');
  });

  it('uses non-expiring ownership locks and cannot delete a replacement lock', async () => {
    const owner = await acquireRefreshLock('same-event-market');
    expect(owner).toBeTruthy();
    const keys = await command('KEYS', '*lock:*');
    expect(await command('PTTL', keys[0])).toBe(-1);
    await command('SET', keys[0], 'replacement-owner');
    await releaseRefreshLock('same-event-market', owner!);
    expect(await command('GET', keys[0])).toBe('replacement-owner');
    expect(await acquireRefreshLock('same-event-market')).toBeNull();
  });

  it('fails closed when storage is unavailable', async () => {
    state.available = false;
    await expect(reserveDailyCredits(1)).rejects.toMatchObject({ reason: 'STORAGE_UNAVAILABLE' });
    await expect(acquireRefreshLock('missing')).rejects.toMatchObject({ reason: 'STORAGE_UNAVAILABLE' });
  });

  it('deduplicates identical market sets despite URL parameter and market ordering', async () => {
    const owner = await acquireRefreshLock('https://example.test/events/game/odds?regions=us&markets=points,assists');
    expect(owner).toBeTruthy();
    expect(await acquireRefreshLock('https://example.test/events/game/odds?markets=assists,points&regions=us')).toBeNull();
  });

  it('prevents simultaneous overlapping-market purchases for the same provider event', async () => {
    expect(await acquireRefreshLock('https://example.test/events/game/odds?markets=points&regions=us')).toBeTruthy();
    expect(await acquireRefreshLock('https://example.test/events/game/odds?markets=points,assists&regions=us')).toBeNull();
  });

  it('keeps abandoned worker reservations indefinitely instead of silently refunding them', async () => {
    await recordProviderRemaining('2400');
    const reservation = await reserveDailyCredits(50, new Date(Date.now() - 86400000));
    expect(await command('PTTL', reservation.id)).toBe(-1);
    expect(await command('HGET', account, 'pending')).toBe('50');
    expect(await command('HGET', account, 'remaining')).toBe('2350');
  });

  it('tracks actual costs separately and blocks when the provider violates the cost estimate', async () => {
    await recordProviderRemaining('2100');
    const reservation = await reserveDailyCredits(2);
    await settleDailyCredits(reservation, 3);
    expect(await command('HGET', reservation.dayKey, 'actual')).toBe('3');
    expect(await command('HGET', reservation.dayKey, 'spent')).toBe('3');
    await expect(reserveDailyCredits(1)).rejects.toMatchObject({ reason: 'REMAINING_UNKNOWN' });
  });
});