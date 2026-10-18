export interface ReadRetryOptions {
  attempts?: number;
  timeoutMs?: number;
  delay?: (milliseconds: number) => Promise<void>;
}

export async function fetchWithReadRetry(url: string | URL, init: RequestInit = {}, options: ReadRetryOptions = {}): Promise<Response> {
  const attempts = Math.max(1, Math.min(3, options.attempts ?? 3));
  const delay = options.delay ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, { ...init, signal: AbortSignal.timeout(options.timeoutMs ?? 8000) });
    } catch (error) {
      if (attempt + 1 === attempts) throw error;
      await delay(200 * 2 ** attempt);
      continue;
    }
    if (![408, 429, 502, 503, 504].includes(response.status) || attempt + 1 === attempts) return response;
    const header = response.headers.get('retry-after');
    const seconds = header && /^\d+(?:\.\d+)?$/.test(header) ? Number(header) * 1000 : null;
    const retryAt = header && seconds == null ? Date.parse(header) : NaN;
    const retryAfter = seconds ?? (Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : 0);
    if (retryAfter > 2000) return response;
    await response.body?.cancel();
    await delay(Math.max(200 * 2 ** attempt, retryAfter));
  }
  throw new Error('Read retry exhausted.');
}