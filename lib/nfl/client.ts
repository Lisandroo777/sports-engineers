/**
 * Server-only ESPN fetch wrapper for NFL data.
 * ESPN's public NFL API is unofficial/undocumented, so every response is normalized
 * into our own types (see types.ts) before leaving lib/nfl — no ESPN-shaped objects
 * or ESPN-specific IDs should ever reach a React component directly. This keeps the
 * provider swappable for a licensed source later without touching Research Lab.
 */
const SITE_BASE_URL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const WEB_BASE_URL = 'https://site.web.api.espn.com/apis';

export class NFLDataUnavailableError extends Error {
  constructor(message = 'NFL data is currently unavailable.') {
    super(message);
    this.name = 'NFLDataUnavailableError';
  }
}

async function fetchJson<T>(url: string, revalidate: number): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json' },
      next: { revalidate },
    });
  } catch {
    throw new NFLDataUnavailableError('Unable to reach the NFL data provider.');
  }

  if (!response.ok) {
    console.error(`[nfl] Request failed for ${url}: ${response.status} ${response.statusText}`);
    throw new NFLDataUnavailableError(`NFL request failed (${response.status})`);
  }

  return (await response.json()) as T;
}

/** site.api.espn.com — scoreboard, teams, rosters. */
export function espnSiteFetch<T>(path: string, params: Record<string, string> = {}, revalidate = 300): Promise<T> {
  const url = new URL(`${SITE_BASE_URL}/${path.replace(/^\//, '')}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return fetchJson<T>(url.toString(), revalidate);
}

/** site.web.api.espn.com — player search, athlete profiles, game logs. */
export function espnWebFetch<T>(path: string, params: Record<string, string> = {}, revalidate = 300): Promise<T> {
  const url = new URL(`${WEB_BASE_URL}/${path.replace(/^\//, '')}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
  return fetchJson<T>(url.toString(), revalidate);
}
