const DEFAULT_BASE_URL = process.env.MLB_API_BASE_URL || 'https://statsapi.mlb.com/api/v1';

export class MLBDataUnavailableError extends Error {
  constructor(message = 'MLB data is currently unavailable.') {
    super(message);
    this.name = 'MLBDataUnavailableError';
  }
}

export function allowMLBMockFallback() {
  return process.env.NODE_ENV !== 'production' && process.env.MLB_ALLOW_MOCK_FALLBACK === 'true';
}

export function getMLBApiBaseUrl() {
  return DEFAULT_BASE_URL.replace(/\/$/, '');
}

export async function mlbFetch<T>(path: string, options?: { revalidate?: number; init?: RequestInit }) {
  const baseUrl = getMLBApiBaseUrl();
  const url = new URL(`${baseUrl}/${path.replace(/^\//, '')}`);

  const response = await fetch(url.toString(), {
    headers: {
      accept: 'application/json',
    },
    next: {
      revalidate: options?.revalidate ?? 300,
    },
    ...options?.init,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[mlb] Request failed for ${url.toString()}: ${response.status} ${response.statusText}`);
    console.error(`[mlb] Body: ${errorText.slice(0, 220)}`);
    throw new MLBDataUnavailableError(`MLB request failed (${response.status})`);
  }

  return (await response.json()) as T;
}

export function formatMLBDate(date: Date | string = new Date()) {
  const inputDate = typeof date === 'string' ? new Date(date) : date;
  return inputDate.toISOString().slice(0, 10);
}
