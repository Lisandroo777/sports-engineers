import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allowLocalPersistenceFallback, hasDurableKV, kvDel, kvEval, kvGetJson, kvSetJson, kvSetNx } from './kv';

beforeEach(() => {
  for (const key of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) vi.stubEnv(key, '');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ result: '{"ok":true}' })));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('durable Redis configuration', () => {
  it('round-trips synthetic Preview data and sends lock/Lua commands only to the isolated mock endpoint', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://isolated-preview.example');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'synthetic-preview-token');
    const records = new Map<string, string>();
    const commands: Array<Array<string | number>> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe('https://isolated-preview.example');
      const command = JSON.parse(String(init?.body)) as Array<string | number>;
      commands.push(command);
      if (command[0] === 'SET') {
        if (command.includes('NX') && records.has(String(command[1]))) return Response.json({ result: null });
        records.set(String(command[1]), String(command[2]));
        return Response.json({ result: 'OK' });
      }
      if (command[0] === 'GET') return Response.json({ result: records.get(String(command[1])) ?? null });
      if (command[0] === 'DEL') return Response.json({ result: records.delete(String(command[1])) ? 1 : 0 });
      if (command[0] === 'EVAL') return Response.json({ result: 'synthetic-lua-result' });
      throw new Error('Unexpected synthetic Redis command');
    }));
    await kvSetJson('preview-test:sample', { fixture: true, tier: null }, 60000);
    expect(await kvGetJson('preview-test:sample')).toEqual({ fixture: true, tier: null });
    expect(await kvSetNx('preview-test:lock', 'owner-one', 1000)).toBe(true);
    expect(await kvSetNx('preview-test:lock', 'owner-two', 1000)).toBe(false);
    expect(await kvEval('return ARGV[1]', ['preview-test:key'], ['synthetic-lua-result'])).toBe('synthetic-lua-result');
    await kvDel('preview-test:sample');
    expect(await kvGetJson('preview-test:sample')).toBeNull();
    expect(allowLocalPersistenceFallback()).toBe(false);
    expect(commands).toContainEqual(['SET', 'preview-test:sample', JSON.stringify({ fixture: true, tier: null }), 'PX', 60000]);
    expect(commands).toContainEqual(['EVAL', 'return ARGV[1]', 1, 'preview-test:key', 'synthetic-lua-result']);
  });

  it('does not silently fall back to disk when Preview credentials are absent in production runtime', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(hasDurableKV()).toBe(false);
    expect(allowLocalPersistenceFallback()).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses the complete Upstash REST pair and adds Bearer exactly once', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', ' https://upstash.test/ ');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', ' upstash-token ');
    expect(await kvGetJson('probe')).toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith('https://upstash.test', expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer upstash-token' }),
    }));
  });

  it('prefers a complete KV pair over Upstash', async () => {
    vi.stubEnv('KV_REST_API_URL', 'https://kv.test');
    vi.stubEnv('KV_REST_API_TOKEN', 'kv-token');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://upstash.test');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'upstash-token');
    await kvGetJson('probe');
    expect(fetch).toHaveBeenCalledWith('https://kv.test', expect.objectContaining({
      headers: expect.objectContaining({ authorization: 'Bearer kv-token' }),
    }));
  });

  it.each(['KV_REST_API_URL', 'KV_REST_API_TOKEN'])('rejects a partial %s override without mixing credential families', (key) => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://upstash.test');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'upstash-token');
    vi.stubEnv(key, key.endsWith('URL') ? 'https://kv.test' : 'kv-token');
    expect(() => hasDurableKV()).toThrow('must be configured together');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['Bearer secret-token', '"secret-token"', 'secret\ntoken', '[SENSITIVE]'])('rejects malformed tokens without exposing them', async (token) => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://upstash.test');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', token);
    await expect(kvGetJson('probe')).rejects.toThrow('must be the raw REST token');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['redis://user:password@redis.test', 'https://user:password@redis.test', 'https://redis.test?token=secret', 'https://redis.test/get/key', '"https://redis.test"'])('rejects non-REST URLs without making a request', async (url) => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', url);
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'token');
    await expect(kvGetJson('probe')).rejects.toThrow('HTTPS REST endpoint');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves authentication failure without leaking the provider response or token', async () => {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://upstash.test');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'secret-token');
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: 'sensitive provider detail' }, { status: 401 }));
    await expect(kvGetJson('probe')).rejects.toThrow(/^Durable KV request failed \(401\)$/);
  });

  it('reports absent configuration without enabling a production fallback', () => {
    expect(hasDurableKV()).toBe(false);
  });
});