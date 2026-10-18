import { randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResearchSession } from './session';

const storage = vi.hoisted(() => ({
  hasDurableKV: vi.fn(),
  allowLocalPersistenceFallback: vi.fn(),
  kvSetJson: vi.fn(),
  kvGetJson: vi.fn(),
  kvDel: vi.fn(),
}));
const disk = vi.hoisted(() => ({
  existsSync: vi.fn(), mkdirSync: vi.fn(), writeFileSync: vi.fn(),
  readdirSync: vi.fn(), readFileSync: vi.fn(), unlinkSync: vi.fn(),
}));
vi.mock('../../storage/kv', () => storage);
vi.mock('fs', () => disk);

const TTL_MS = 24 * 60 * 60 * 1000;
const persistenceError = 'Research session could not be persisted.';
const unavailableError = 'Research session is temporarily unavailable.';
const privateError = new Error('request failed: Bearer private-token');

function fixture(): ResearchSession {
  return {
    sport: 'nba', date: '2026-10-18', queryIntent: 'research',
    generatedAt: '2026-10-18T12:00:00Z', candidates: [],
    toolMeta: {
      gamesFound: 1, gamesScheduled: 1, propsFound: 0, booksFound: 0,
      candidatesFound: 0, eliteFound: 0, cached: false,
      dataFreshnessSeconds: 0, budgetLimited: false,
    },
  };
}

function storedSession(session = fixture(), expiresAt = Date.now() + TTL_MS) {
  return {
    id: 'known-id', savedAt: Date.now(), expiresAt,
    sessionEncoding: 'deflate-base64-v1',
    compressedSession: deflateSync(Buffer.from(JSON.stringify(session))).toString('base64'),
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  vi.stubEnv('NODE_ENV', 'test');
  storage.hasDurableKV.mockReturnValue(true);
  storage.allowLocalPersistenceFallback.mockReturnValue(false);
  storage.kvSetJson.mockResolvedValue(undefined);
  storage.kvGetJson.mockResolvedValue(null);
  storage.kvDel.mockResolvedValue(undefined);
  disk.existsSync.mockReturnValue(true);
  disk.readdirSync.mockReturnValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('session persistence and recovery', () => {
  it('does not return an ID, retry, use disk, or cache an ambiguous durable write', async () => {
    const store = await import('./sessionStore');
    storage.kvSetJson.mockRejectedValue(privateError);
    await expect(store.saveResearchSession(fixture())).rejects.toThrow(persistenceError);
    expect(storage.kvSetJson).toHaveBeenCalledTimes(1);
    expect(disk.writeFileSync).not.toHaveBeenCalled();
    const key = storage.kvSetJson.mock.calls[0][0] as string;
    storage.kvGetJson.mockRejectedValue(privateError);
    await expect(store.getResearchSession(key.slice('ai-session:'.length))).rejects.toThrow(unavailableError);
  });

  it('fails closed without production storage, even if local fallback is allowed', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    storage.hasDurableKV.mockReturnValue(false);
    storage.allowLocalPersistenceFallback.mockReturnValue(true);
    const store = await import('./sessionStore');
    await expect(store.saveResearchSession(fixture())).rejects.toThrow(persistenceError);
    expect(disk.writeFileSync).not.toHaveBeenCalled();
  });

  it('sanitizes invalid durable configuration', async () => {
    storage.hasDurableKV.mockImplementation(() => { throw privateError; });
    const store = await import('./sessionStore');
    await expect(store.saveResearchSession(fixture())).rejects.toThrow(persistenceError);
    expect(disk.writeFileSync).not.toHaveBeenCalled();
  });

  it('rejects disabled local storage and sanitizes local disk failures', async () => {
    storage.hasDurableKV.mockReturnValue(false);
    const store = await import('./sessionStore');
    await expect(store.saveResearchSession(fixture())).rejects.toThrow(persistenceError);
    storage.allowLocalPersistenceFallback.mockReturnValue(true);
    disk.writeFileSync.mockImplementation(() => { throw privateError; });
    await expect(store.saveResearchSession(fixture())).rejects.toThrow(persistenceError);
    expect(disk.writeFileSync).toHaveBeenCalledTimes(1);
  });

  it('preserves normal local disk save, read, and delete', async () => {
    storage.hasDurableKV.mockReturnValue(false);
    storage.allowLocalPersistenceFallback.mockReturnValue(true);
    const store = await import('./sessionStore');
    const id = await store.saveResearchSession(fixture());
    const [path, serialized] = disk.writeFileSync.mock.calls[0];
    expect(path).toContain(`${id}.json`);
    disk.readFileSync.mockReturnValue(serialized);
    await expect(store.getResearchSession(id)).resolves.toEqual(fixture());
    await store.deleteResearchSession(id);
    expect(disk.unlinkSync).toHaveBeenCalledWith(path);
  });

  it('recovers only a confirmed durable save and returns independent snapshots', async () => {
    const store = await import('./sessionStore');
    const original = fixture();
    const id = await store.saveResearchSession(original);
    original.queryIntent = 'mutated';
    storage.kvGetJson.mockRejectedValue(privateError);
    const recovered = await store.getResearchSession(id);
    expect(recovered).toEqual(fixture());
    recovered!.toolMeta.cached = true;
    await expect(store.getResearchSession(id)).resolves.toEqual(fixture());
    expect(storage.kvSetJson).toHaveBeenCalledTimes(1);
    expect(disk.readFileSync).not.toHaveBeenCalled();
  });

  it('recovers a successful durable read after KV exhausts its own retries', async () => {
    const store = await import('./sessionStore');
    storage.kvGetJson.mockResolvedValueOnce(storedSession()).mockRejectedValue(privateError);
    const loaded = await store.getResearchSession('known-id');
    loaded!.queryIntent = 'mutated';
    await expect(store.getResearchSession('known-id')).resolves.toEqual(fixture());
    expect(storage.kvGetJson).toHaveBeenCalledTimes(2);
    await expect(store.getResearchSession('unknown-id')).rejects.toThrow(unavailableError);
  });

  it('accepts a successful KV read without adding another retry layer', async () => {
    const store = await import('./sessionStore');
    storage.kvGetJson.mockResolvedValue(storedSession());
    await expect(store.getResearchSession('known-id')).resolves.toEqual(fixture());
    expect(storage.kvGetJson).toHaveBeenCalledTimes(1);
  });

  it('expires recovery at 24 hours without extending TTL on reads', async () => {
    vi.useFakeTimers();
    const store = await import('./sessionStore');
    const id = await store.saveResearchSession(fixture());
    storage.kvGetJson.mockRejectedValue(privateError);
    vi.advanceTimersByTime(TTL_MS - 1);
    await expect(store.getResearchSession(id)).resolves.toEqual(fixture());
    vi.advanceTimersByTime(1);
    await expect(store.getResearchSession(id)).rejects.toThrow(unavailableError);
  });

  it('honors shorter durable TTLs', async () => {
    vi.useFakeTimers();
    const store = await import('./sessionStore');
    storage.kvGetJson.mockResolvedValueOnce(storedSession(fixture(), Date.now() + 1000));
    await store.getResearchSession('known-id');
    storage.kvGetJson.mockRejectedValue(privateError);
    vi.advanceTimersByTime(1000);
    await expect(store.getResearchSession('known-id')).rejects.toThrow(unavailableError);
  });

  it.each([null, { ...storedSession(), expiresAt: 0 }, { ...storedSession(), compressedSession: 'corrupt' }])(
    'invalidates recovery when the durable read returns missing, expired, or corrupt data', async (invalid) => {
      const store = await import('./sessionStore');
      const id = await store.saveResearchSession(fixture());
      storage.kvGetJson.mockResolvedValueOnce(invalid).mockRejectedValue(privateError);
      await expect(store.getResearchSession(id)).resolves.toBeNull();
      await expect(store.getResearchSession(id)).rejects.toThrow(unavailableError);
    },
  );

  it('clears recovery before deleting even when durable deletion fails', async () => {
    const store = await import('./sessionStore');
    const id = await store.saveResearchSession(fixture());
    storage.kvDel.mockRejectedValue(privateError);
    await expect(store.deleteResearchSession(id)).rejects.toThrow();
    storage.kvGetJson.mockRejectedValue(privateError);
    await expect(store.getResearchSession(id)).rejects.toThrow(unavailableError);
  });

  it('caps the recovery cache at 20 compressed sessions', async () => {
    const store = await import('./sessionStore');
    const ids: string[] = [];
    for (let index = 0; index < 21; index++) ids.push(await store.saveResearchSession(fixture()));
    storage.kvGetJson.mockRejectedValue(privateError);
    await expect(store.getResearchSession(ids[0])).rejects.toThrow(unavailableError);
    await expect(store.getResearchSession(ids[1])).resolves.toEqual(fixture());
    await expect(store.getResearchSession(ids[20])).resolves.toEqual(fixture());
  });

  it('bounds total compressed recovery bytes and skips oversized snapshots', async () => {
    const store = await import('./sessionStore');
    const large = { ...fixture(), queryIntent: randomBytes(2 * 1024 * 1024).toString('base64') };
    const oldest = await store.saveResearchSession(large);
    const recent = await store.saveResearchSession(large);
    storage.kvGetJson.mockRejectedValue(privateError);
    await expect(store.getResearchSession(oldest)).rejects.toThrow(unavailableError);
    await expect(store.getResearchSession(recent)).resolves.toEqual(large);
    const oversized = { ...fixture(), queryIntent: randomBytes(5 * 1024 * 1024).toString('base64') };
    const oversizedId = await store.saveResearchSession(oversized);
    await expect(store.getResearchSession(oversizedId)).rejects.toThrow(unavailableError);
    await expect(store.getResearchSession(recent)).resolves.toEqual(large);
  });
});