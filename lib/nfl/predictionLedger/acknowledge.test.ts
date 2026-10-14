import { describe, expect, it, vi } from 'vitest';
import { acknowledgeNFLPresentation } from './acknowledge';

describe('NFL presentation acknowledgement', () => {
  it('submits every displayed ID once and deduplicates identical IDs', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ created: 2 }));
    await acknowledgeNFLPresentation('signed-receipt', ['first', 'second', 'first'], request);
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ receipt: 'signed-receipt', candidateIds: ['first', 'second'] });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(['network', 'server'])('retries a transient %s failure with exactly the same signed payload', async failure => {
    const request = vi.fn<typeof fetch>();
    if (failure === 'network') request.mockRejectedValueOnce(new Error('offline'));
    else request.mockResolvedValueOnce(new Response(null, { status: 503 }));
    request.mockResolvedValueOnce(Response.json({ created: 0, duplicates: 2 }));
    await expect(acknowledgeNFLPresentation('receipt', ['first', 'second'], request)).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0][1]?.body).toBe(request.mock.calls[1][1]?.body);
  });

  it('does not retry invalid or expired receipts', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 }));
    await expect(acknowledgeNFLPresentation('expired', ['first'], request)).rejects.toThrow('rejected');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('bounds persistent failures instead of reporting success', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('offline'));
    await expect(acknowledgeNFLPresentation('receipt', ['first'], request)).rejects.toThrow('unavailable');
    expect(request).toHaveBeenCalledTimes(2);
  });
});