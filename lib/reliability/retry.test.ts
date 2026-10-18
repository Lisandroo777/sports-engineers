import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWithReadRetry } from './retry';

afterEach(() => vi.unstubAllGlobals());

describe('bounded idempotent read recovery', () => {
  it('recovers transient reads with bounded exponential delays', async () => {
    const request = vi.fn().mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(Response.json({ ok: true }));
    vi.stubGlobal('fetch', request);
    const delay = vi.fn(async () => {});
    expect((await fetchWithReadRetry('https://fixture.test', {}, { delay })).ok).toBe(true);
    expect(delay.mock.calls).toEqual([[200], [400]]);
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.every(([, init]) => init.signal instanceof AbortSignal)).toBe(true);
  });

  it.each([400, 401, 403, 404])('never retries permanent HTTP %s failures', async status => {
    const request = vi.fn(async () => new Response(null, { status }));
    vi.stubGlobal('fetch', request);
    expect((await fetchWithReadRetry('https://fixture.test')).status).toBe(status);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not retry sooner than a long provider rate-limit instruction', async () => {
    const request = vi.fn(async () => new Response(null, { status: 429, headers: { 'Retry-After': '60' } }));
    vi.stubGlobal('fetch', request);
    const delay = vi.fn(async () => {});
    expect((await fetchWithReadRetry('https://fixture.test', {}, { delay })).status).toBe(429);
    expect(request).toHaveBeenCalledTimes(1);
    expect(delay).not.toHaveBeenCalled();
  });

  it('honors short Retry-After and stops after three attempts', async () => {
    const request = vi.fn(async () => new Response(null, { status: 429, headers: { 'Retry-After': '1' } }));
    vi.stubGlobal('fetch', request);
    const delay = vi.fn(async () => {});
    expect((await fetchWithReadRetry('https://fixture.test', {}, { delay })).status).toBe(429);
    expect(request).toHaveBeenCalledTimes(3);
    expect(delay.mock.calls).toEqual([[1000], [1000]]);
  });
});