import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResearchSession } from './session';

vi.mock('node:zlib', { spy: true });

const storage = vi.hoisted(() => ({
  values: new Map<string, unknown>(),
  kvSetJson: vi.fn(), kvGetJson: vi.fn(), kvDel: vi.fn(),
}));

vi.mock('../../storage/kv', () => ({
  hasDurableKV: () => true,
  allowLocalPersistenceFallback: () => false,
  kvSetJson: storage.kvSetJson,
  kvGetJson: storage.kvGetJson,
  kvDel: storage.kvDel,
}));

function fixture(): ResearchSession {
  return {
    sport: 'nfl', date: '2026-10-18', queryIntent: 'Full NFL slate',
    generatedAt: '2026-10-18T12:00:00Z',
    toolMeta: { gamesFound: 8, gamesScheduled: 8, propsFound: 6113, booksFound: 6,
      candidatesFound: 6113, eliteFound: 0, cached: true, dataFreshnessSeconds: 0, budgetLimited: false },
    candidates: Array.from({ length: 6113 }, (_, index) => ({
      candidateId: `candidate-${index}`, rank: index + 1,
      nflResearchProfile: { evidence: randomBytes(256).toString('hex') },
    })) as unknown as ResearchSession['candidates'],
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  storage.values.clear();
  storage.kvSetJson.mockImplementation(async (key: string, value: unknown, ttl: number) => {
    const request = JSON.stringify(['SET', key, JSON.stringify(value), 'PX', ttl]);
    if (Buffer.byteLength(request) > 1_000_000) throw new Error('KV request exceeds 1 MB');
    storage.values.set(key, structuredClone(value));
  });
  storage.kvGetJson.mockImplementation(async (key: string) => storage.values.get(key) ?? null);
  storage.kvDel.mockImplementation(async (key: string) => { storage.values.delete(key); });
});

async function roundTrip(session: ResearchSession) {
  expect(deflateSync(JSON.stringify(session)).toString('base64').length).toBeGreaterThan(1_000_000);
  const writer = await import('./sessionStore');
  const id = await writer.saveResearchSession(session);
  const manifestKey = `ai-session:${id}`;
  const manifest = storage.values.get(manifestKey) as { compressedSessionChunks: number };
  expect(manifest.compressedSessionChunks).toBeGreaterThan(1);
  expect(storage.kvSetJson.mock.calls.at(-1)?.[0]).toBe(manifestKey);
  for (const [, , ttl] of storage.kvSetJson.mock.calls) expect(ttl).toBe(24 * 60 * 60 * 1000);
  vi.resetModules();
  const reader = await import('./sessionStore');
  expect(await reader.getResearchSession(id)).toEqual(session);
  await reader.deleteResearchSession(id);
  expect(storage.values.size).toBe(0);
}

describe('research sessions exceeding a single KV request', () => {
  it('durably round-trips all 6113 heterogeneous candidates below the per-command limit', async () => {
    await roundTrip(fixture());
  });

  it.each(['chunk', 'manifest'])('cleans up a failed %s write without returning or recovering an ID', async (failure) => {
    const store = await import('./sessionStore');
    const write = storage.kvSetJson.getMockImplementation()!;
    storage.kvSetJson.mockImplementation(async (key: string, value: unknown, ttl: number) => {
      await write(key, value, ttl);
      if (failure === 'manifest' ? !key.includes(':chunk:') : key.endsWith(':chunk:1')) throw new Error('private storage error');
    });
    await expect(store.saveResearchSession(fixture())).rejects.toThrow('Research session could not be persisted.');
    expect(storage.values.size).toBe(0);
    const id = String(storage.kvSetJson.mock.calls[0][0]).split(':')[1];
    storage.kvGetJson.mockRejectedValue(new Error('private storage error'));
    await expect(store.getResearchSession(id)).rejects.toThrow('Research session is temporarily unavailable.');
  });

  it.each(['missing', 'corrupt', 'empty', 'oversized', 'invalid-count', 'invalid-encoding', 'invalid-expiry', 'missing-encoding', 'missing-count', 'invalid-json', 'invalid-session'])('preserves recovery for %s chunked data and fails closed on a cold read', async (failure) => {
    const store = await import('./sessionStore');
    const session = fixture();
    const id = await store.saveResearchSession(session);
    const key = `ai-session:${id}`;
    if (failure === 'missing') storage.values.delete(`${key}:chunk:1`);
    if (failure === 'corrupt') storage.values.set(`${key}:chunk:1`, 'corrupt');
    if (failure === 'empty') storage.values.set(`${key}:chunk:1`, '');
    if (failure === 'oversized') storage.values.set(`${key}:chunk:1`, 'a'.repeat(500_001));
    const manifest = storage.values.get(key) as Record<string, unknown>;
    if (failure === 'invalid-count') storage.values.set(key, { ...manifest, compressedSessionChunks: 1e9 });
    if (failure === 'invalid-encoding') storage.values.set(key, { ...manifest, sessionEncoding: 'unknown' });
    if (failure === 'invalid-expiry') storage.values.set(key, { ...manifest, expiresAt: null });
    if (failure === 'missing-encoding') storage.values.set(key, { id, savedAt: manifest.savedAt, expiresAt: manifest.expiresAt });
    if (failure === 'missing-count') storage.values.set(key, { ...manifest, compressedSessionChunks: undefined });
    if (failure === 'invalid-json' || failure === 'invalid-session') {
      storage.values.set(key, { ...manifest, compressedSessionChunks: 1 });
      storage.values.set(`${key}:chunk:0`, deflateSync(failure === 'invalid-json' ? 'not JSON' : '{}').toString('base64'));
    }
    await expect(store.getResearchSession(id)).resolves.toEqual(session);
    storage.kvGetJson.mockRejectedValueOnce(new Error('private storage error'));
    await expect(store.getResearchSession(id)).resolves.toEqual(session);
    vi.resetModules();
    const coldStore = await import('./sessionStore');
    await expect(coldStore.getResearchSession(id)).rejects.toThrow('Research session is temporarily unavailable.');
  });

  it.each(['absent', 'expired'])('returns null and invalidates recovery for an %s root', async (failure) => {
    const store = await import('./sessionStore');
    const id = await store.saveResearchSession(fixture());
    const key = `ai-session:${id}`;
    if (failure === 'absent') storage.values.delete(key);
    else storage.values.set(key, { ...storage.values.get(key) as object, expiresAt: 0 });
    await expect(store.getResearchSession(id)).resolves.toBeNull();
    storage.kvGetJson.mockRejectedValue(new Error('offline'));
    await expect(store.getResearchSession(id)).rejects.toThrow('Research session is temporarily unavailable.');
  });

  it('reads all 64 chunks in order with at most four reads in flight', async () => {
    const session = fixture();
    const store = await import('./sessionStore');
    const id = await store.saveResearchSession(session);
    const key = `ai-session:${id}`;
    const compressed = deflateSync(JSON.stringify(session)).toString('base64');
    const chunkSize = Math.ceil(compressed.length / 64);
    const manifest = storage.values.get(key) as Record<string, unknown>;
    storage.values.set(key, { ...manifest, compressedSessionChunks: 64 });
    for (let index = 0; index < 64; index++) {
      storage.values.set(`${key}:chunk:${index}`, compressed.slice(index * chunkSize, (index + 1) * chunkSize));
    }
    let active = 0;
    let peak = 0;
    let reads = 0;
    storage.kvGetJson.mockImplementation(async (chunkKey: string) => {
      if (!chunkKey.includes(':chunk:')) return storage.values.get(chunkKey) ?? null;
      reads++;
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, reads % 3));
      active--;
      return storage.values.get(chunkKey) ?? null;
    });
    vi.resetModules();
    const coldStore = await import('./sessionStore');
    await expect(coldStore.getResearchSession(id)).resolves.toEqual(session);
    expect(reads).toBe(64);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('recovers a confirmed session when a chunk read fails transiently', async () => {
    const store = await import('./sessionStore');
    const session = fixture();
    const id = await store.saveResearchSession(session);
    const read = storage.kvGetJson.getMockImplementation()!;
    storage.kvGetJson.mockImplementation(async (key: string) => {
      if (key.includes(':chunk:')) throw new Error('offline');
      return read(key);
    });
    await expect(store.getResearchSession(id)).resolves.toEqual(session);
  });

  it('reuses verified compressed payloads for recovery after saves and cold reads', async () => {
    const session = fixture();
    const store = await import('./sessionStore');
    const id = await store.saveResearchSession(session);
    expect(deflateSync).toHaveBeenCalledTimes(1);
    vi.resetModules();
    const coldStore = await import('./sessionStore');
    await expect(coldStore.getResearchSession(id)).resolves.toEqual(session);
    expect(deflateSync).toHaveBeenCalledTimes(1);
    storage.kvGetJson.mockRejectedValue(new Error('offline'));
    await expect(coldStore.getResearchSession(id)).resolves.toEqual(session);
    expect(deflateSync).toHaveBeenCalledTimes(1);
  });

  it.skipIf(!process.env.DEEPSIDE_OFFLINE_SESSION_ARTIFACT)('replays unchanged real NFL profiles without provider calls', async () => {
    const artifact = JSON.parse(readFileSync(process.env.DEEPSIDE_OFFLINE_SESSION_ARTIFACT!, 'utf8'));
    const result = artifact.result ?? artifact;
    const session = fixture();
    session.candidates = Array.from({ length: 96 }, (_, index) => ({
      ...result.results[index % result.results.length], candidateId: `offline-${index}`, rank: index + 1,
    }));
    await roundTrip(session);
  });
});