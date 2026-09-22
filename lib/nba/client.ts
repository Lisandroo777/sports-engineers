/** Server-only ESPN client for NBA data. Raw ESPN shapes stay inside lib/nba. */
const SITE_BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const WEB_BASE_URL = 'https://site.web.api.espn.com/apis';

export class NBADataUnavailableError extends Error {
  constructor(message = 'NBA data is currently unavailable.') {
    super(message);
    this.name = 'NBADataUnavailableError';
  }
}

async function fetchJson<T>(url: string, revalidate: number): Promise<T> {
  try {
    const response = await fetch(url, { headers: { accept: 'application/json' }, next: { revalidate } });
    if (!response.ok) throw new NBADataUnavailableError(`NBA request failed (${response.status})`);
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof NBADataUnavailableError) throw error;
    throw new NBADataUnavailableError('Unable to reach the NBA data provider.');
  }
}

export function espnNBASiteFetch<T>(path: string, params: Record<string, string> = {}, revalidate = 300): Promise<T> {
  const url = new URL(`${SITE_BASE_URL}/${path.replace(/^\//, '')}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return fetchJson<T>(url.toString(), revalidate);
}

export function espnNBAWebFetch<T>(path: string, params: Record<string, string> = {}, revalidate = 300): Promise<T> {
  const url = new URL(`${WEB_BASE_URL}/${path.replace(/^\//, '')}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return fetchJson<T>(url.toString(), revalidate);
}
