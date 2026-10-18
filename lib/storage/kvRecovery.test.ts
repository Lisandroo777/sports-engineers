import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { kvDel, kvDeleteByPrefix, kvEval, kvGetJson, kvSetJson, kvSetNx } from './kv';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('KV_REST_API_URL', 'https://kv.test');
  vi.stubEnv('KV_REST_API_TOKEN', 'fixture-token');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('durable KV read recovery', () => {
  it.each([503, 429])('recovers a GET after HTTP %s using the POST transport', async (status) => {
    const request = vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(Response.json({ result: '{"ok":true}' }));
    const result = kvGetJson('fixture-key');
    await vi.advanceTimersByTimeAsync(199);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({ ok: true });
    expect(request).toHaveBeenCalledTimes(2);
    for (const [url, init] of request.mock.calls) {
      expect(url).toBe('https://kv.test');
      expect(init).toEqual(expect.objectContaining({
        method: 'POST', body: '["GET","fixture-key"]', signal: expect.any(AbortSignal),
      }));
    }
  });

  it('retries actual kvGetJson network failures exactly three times with 200/400ms backoff', async () => {
    const request = vi.mocked(fetch).mockRejectedValue(new TypeError('network unavailable'));
    const failure = expect(kvGetJson('fixture-key')).rejects.toThrow('network unavailable');
    await vi.advanceTimersByTimeAsync(199);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(399);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await failure;
    expect(request).toHaveBeenCalledTimes(3);
  });

  it.each([503, 429])('bounds persistent HTTP %s failures at three attempts', async (status) => {
    const request = vi.mocked(fetch).mockImplementation(async () => new Response(null, { status }));
    const failure = expect(kvGetJson('fixture-key')).rejects.toThrow(`Durable KV request failed (${status})`);
    await vi.advanceTimersByTimeAsync(600);
    await failure;
    expect(request).toHaveBeenCalledTimes(3);
  });

  it.each([401, 403])('does not retry HTTP %s or expose its response body', async (status) => {
    const request = vi.mocked(fetch).mockResolvedValue(Response.json({ error: 'fixture-token fixture-key' }, { status }));
    await expect(kvGetJson('fixture-key')).rejects.toThrow(new Error(`Durable KV request failed (${status})`));
    await vi.advanceTimersByTimeAsync(2000);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(['1', '2'])('honors a short Retry-After of %s seconds', async (seconds) => {
    const request = vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': seconds } }))
      .mockResolvedValueOnce(Response.json({ result: 'null' }));
    const result = kvGetJson('fixture-key');
    await vi.advanceTimersByTimeAsync(Number(seconds) * 1000 - 1);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not retry a Retry-After longer than two seconds', async () => {
    const request = vi.mocked(fetch).mockResolvedValue(new Response(null, {
      status: 429, headers: { 'Retry-After': '3' },
    }));
    await expect(kvGetJson('fixture-key')).rejects.toThrow('Durable KV request failed (429)');
    await vi.advanceTimersByTimeAsync(3000);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('retries SCAN but executes the following DEL only once', async () => {
    const request = vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ result: ['0', ['fixture-key']] }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }));
    const failure = expect(kvDeleteByPrefix('fixture-')).rejects.toThrow('Durable KV request failed (503)');
    await vi.advanceTimersByTimeAsync(600);
    await failure;
    expect(request.mock.calls.map(([, init]) => JSON.parse(String(init?.body))[0])).toEqual(['SCAN', 'SCAN', 'DEL']);
  });
});

const writes = [
  { name: 'SET', run: () => kvSetJson('fixture-key', { ok: true }) },
  { name: 'SET PX', run: () => kvSetJson('fixture-key', { ok: true }, 1000) },
  { name: 'SET NX', run: () => kvSetNx('fixture-key', 'reserved', 1000) },
  { name: 'DEL', run: () => kvDel('fixture-key') },
  { name: 'EVAL', run: () => kvEval('return 1', ['fixture-key'], []) },
];

describe('durable KV mutation safety', () => {
  it.each(writes)('$name never retries an uncertain network failure', async ({ run }) => {
    const request = vi.mocked(fetch).mockRejectedValue(new TypeError('network unavailable'));
    await expect(run()).rejects.toThrow('network unavailable');
    await vi.advanceTimersByTimeAsync(2000);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(writes)('$name never retries transient HTTP failures', async ({ run }) => {
    for (const status of [503, 429]) {
      const request = vi.mocked(fetch).mockReset().mockResolvedValue(new Response(null, { status }));
      await expect(run()).rejects.toThrow(`Durable KV request failed (${status})`);
      await vi.advanceTimersByTimeAsync(2000);
      expect(request).toHaveBeenCalledTimes(1);
    }
  });

  it.each(writes)('$name uses an eight-second timeout', async ({ run }) => {
    const signal = new AbortController().signal;
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(signal);
    const request = vi.mocked(fetch).mockResolvedValue(Response.json({ result: 'OK' }));
    await run();
    expect(timeout).toHaveBeenCalledExactlyOnceWith(8000);
    expect(request).toHaveBeenCalledWith('https://kv.test', expect.objectContaining({ signal }));
  });
});

describe('durable KV error and timeout boundaries', () => {
  it('assigns a fresh eight-second timeout to every read attempt', async () => {
    const signals = Array.from({ length: 3 }, () => new AbortController().signal);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    for (const signal of signals) timeout.mockReturnValueOnce(signal);
    const request = vi.mocked(fetch).mockRejectedValue(new TypeError('network unavailable'));
    const failure = expect(kvGetJson('fixture-key')).rejects.toThrow('network unavailable');
    await vi.advanceTimersByTimeAsync(600);
    await failure;
    expect(timeout.mock.calls).toEqual([[8000], [8000], [8000]]);
    expect(request.mock.calls.map(([, init]) => init?.signal)).toEqual(signals);
  });

  it.each([
    { name: 'GET', run: () => kvGetJson('fixture-key') },
    ...writes,
  ])('$name sanitizes Redis command errors without retrying them', async ({ run }) => {
    const request = vi.mocked(fetch).mockResolvedValue(Response.json({ error: 'fixture-key fixture-token secret payload' }));
    await expect(run()).rejects.toThrow(new Error('Durable KV command failed.'));
    await vi.advanceTimersByTimeAsync(2000);
    expect(request).toHaveBeenCalledTimes(1);
  });
});