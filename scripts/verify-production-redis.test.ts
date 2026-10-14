import { describe, expect, it, vi } from 'vitest';
import { verifyRedis } from './verify-production-redis.mjs';

function adapters(failSession = false) {
  const store = new Map<string, unknown>();
  const sessions = new Map<string, unknown>();
  const kv = {
    hasDurableKV: () => true,
    kvSetNx: async (key: string, value: string) => {
      if (store.has(key)) return false;
      store.set(key, value); return true;
    },
    kvEval: async (script: string, keys: string[], args: string[]) => {
      if (script.includes('INCR')) { const value = Number(store.get(keys[0]) ?? 0) + 1; store.set(keys[0], value); return value; }
      if (script.includes('EXISTS')) return keys.filter(key => store.has(key)).length;
      if (store.get(keys[0]) !== args[0]) return 0;
      store.delete(keys[0]); return 1;
    },
    kvSetJson: async (key: string, value: unknown) => { store.set(key, value); },
    kvGetJson: async (key: string) => store.get(key) ?? null,
    kvDel: vi.fn(async (key: string) => { store.delete(key); }),
  };
  const sessionAdapter = {
    saveResearchSession: async (session: unknown) => {
      if (failSession) throw new Error('session failure');
      sessions.set('diagnostic-session', session);
      store.set('ai-session:diagnostic-session', { sessionEncoding: 'deflate-base64-v1', expiresAt: Date.now() + 60000 });
      return 'diagnostic-session';
    },
    getResearchSession: async (id: string) => sessions.get(id) ?? null,
    deleteResearchSession: async (id: string) => { sessions.delete(id); store.delete(`ai-session:${id}`); },
  };
  return { kv, sessionAdapter, store, sessions };
}

describe('isolated production Redis verification', () => {
  it('verifies atomic commands and sessions and removes every diagnostic artifact', async () => {
    const state = adapters();
    await expect(verifyRedis(state.kv, state.sessionAdapter)).resolves.toEqual({ atomicOperations: true, sessionPersistence: true, cleanup: true });
    expect(state.store.size).toBe(0);
    expect(state.sessions.size).toBe(0);
    expect(state.kv.kvDel.mock.calls.every(([key]) => key.startsWith('deepside:diagnostic:'))).toBe(true);
  });

  it('fails closed and cleans temporary keys when session persistence fails', async () => {
    const state = adapters(true);
    await expect(verifyRedis(state.kv, state.sessionAdapter)).rejects.toThrow('session failure');
    expect(state.store.size).toBe(0);
  });
});