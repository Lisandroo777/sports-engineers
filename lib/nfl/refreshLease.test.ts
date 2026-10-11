import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withNFLRefreshLease } from './refreshLease';

const held = vi.hoisted(() => new Set<string>());
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(), stat: vi.fn().mockImplementation(async () => ({ mtimeMs: Date.now() })),
  rm: vi.fn().mockImplementation(async (file) => { held.delete(file); }),
  unlink: vi.fn().mockImplementation(async (file) => { held.delete(file); }),
  open: vi.fn().mockImplementation(async (file) => {
    if (held.has(file)) throw Object.assign(new Error('held'), { code: 'EEXIST' });
    held.add(file); return { writeFile: vi.fn(), close: vi.fn() };
  }),
}));

beforeEach(() => {
  held.clear(); vi.useFakeTimers(); vi.stubEnv('NODE_ENV', 'test');
  for (const key of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) vi.stubEnv(key, '');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('NFL cross-process refresh lease', () => {
  it('serializes refresh operations across separate callers', async () => {
    let finish!: () => void;
    const blocked = new Promise<void>((resolve) => { finish = resolve; });
    const firstOperation = vi.fn().mockImplementation(async () => { await blocked; return 'first'; });
    const secondOperation = vi.fn().mockResolvedValue('second');
    const first = withNFLRefreshLease('same-game', firstOperation);
    await vi.advanceTimersByTimeAsync(0);
    const second = withNFLRefreshLease('same-game', secondOperation);
    await vi.advanceTimersByTimeAsync(100);
    expect(firstOperation).toHaveBeenCalledTimes(1); expect(secondOperation).not.toHaveBeenCalled();
    finish(); await first; await vi.advanceTimersByTimeAsync(100);
    expect(await second).toBe('second'); expect(held.size).toBe(0);
  });

  it('releases the lock even when refresh fails', async () => {
    await expect(withNFLRefreshLease('failed', async () => { throw new Error('fixture'); })).rejects.toThrow('fixture');
    expect(held.size).toBe(0);
    expect(await withNFLRefreshLease('failed', async () => 'recovered')).toBe('recovered');
  });

  it('fails closed in production without durable shared coordination', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const operation = vi.fn();
    await expect(withNFLRefreshLease('game', operation)).rejects.toThrow('not configured');
    expect(operation).not.toHaveBeenCalled();
  });
});