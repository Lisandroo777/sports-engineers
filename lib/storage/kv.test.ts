import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasDurableKV, kvGetJson } from './kv';

beforeEach(() => {
  for (const key of ['KV_REST_API_URL', 'KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN']) vi.stubEnv(key, '');
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ result: '{"ok":true}' })));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('durable Redis configuration', () => {
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