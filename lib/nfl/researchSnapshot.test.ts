import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasDurableKV, kvGetJson, kvSetJson } from '../storage/kv';
import { normalizedNFLInput, memoNFLResearchInput, withNFLResearchSnapshot } from './researchSnapshot';
import { withNFLRefreshLease } from './refreshLease';

vi.mock('../storage/kv', () => ({ hasDurableKV: vi.fn(), kvGetJson: vi.fn(), kvSetJson: vi.fn() }));
vi.mock('./refreshLease', () => ({ withNFLRefreshLease: vi.fn().mockImplementation(async (_key, operation) => operation()) }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(hasDurableKV).mockReturnValue(true); vi.mocked(kvGetJson).mockResolvedValue(null); vi.stubEnv('NODE_ENV', 'development'); });
afterEach(() => vi.unstubAllEnvs());

describe('validated NFL research inputs without stale-while-revalidate', () => {
  it('an expired two-game cache is replaced before the first reader sees it', async () => {
    vi.mocked(kvGetJson).mockResolvedValue({ value: ['week1', 'week2'], fetchedAt: Date.now() - 10000, expiresAt: Date.now() - 1, fingerprint: 'old' });
    const load = vi.fn().mockResolvedValue(['week1', 'week2', 'september27']);
    expect(await normalizedNFLInput('expired-history', 900000, load)).toEqual(['week1', 'week2', 'september27']);
    expect(load).toHaveBeenCalledTimes(1); expect(kvSetJson).toHaveBeenCalledTimes(1);
    expect(withNFLRefreshLease).toHaveBeenCalledWith('nfl-research:v1:expired-history', expect.any(Function));
  });

  it('all candidates reuse the same request input even if the source mutates', async () => {
    const load = vi.fn().mockResolvedValueOnce(['a', 'b', 'september27']).mockResolvedValue(['a', 'b']);
    await withNFLResearchSnapshot(async () => {
      const first = await memoNFLResearchInput('player', load);
      const rest = await Promise.all(Array.from({ length: 30 }, () => memoNFLResearchInput('player', load)));
      expect(rest.every((rows) => rows === first)).toBe(true);
    });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('cold concurrent readers await one complete hydration', async () => {
    const load = vi.fn().mockResolvedValue(['complete']);
    const results = await Promise.all(Array.from({ length: 20 }, () => normalizedNFLInput<string[]>('concurrent', 900000, load)));
    expect(results.every((rows) => rows[0] === 'complete')).toBe(true); expect(load).toHaveBeenCalledTimes(1);
  });

  it('reuses the normalized data snapshot rather than freezing computed picks', async () => {
    const load = vi.fn().mockResolvedValue(['complete']);
    await normalizedNFLInput('persisted', 900000, load);
    const entry = vi.mocked(kvSetJson).mock.calls[0][1];
    vi.mocked(kvGetJson).mockResolvedValue(entry);
    expect(await normalizedNFLInput('persisted', 900000, load)).toEqual(['complete']);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not persist failed/partial hydration', async () => {
    await expect(normalizedNFLInput('broken', 900000, async () => { throw new Error('incomplete'); })).rejects.toThrow('incomplete');
    expect(kvSetJson).not.toHaveBeenCalled();
  });
});