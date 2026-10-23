// Shared, free ESPN game-window selection for NBA V2 historical validation.
export const WINDOW_GAMES = 10;
// ESPN abbreviates the Clippers; sportsbooks use the full city name.
export const sameTeam = (first, second) => {
  const normalize = name => name.replace(/^LA /, 'Los Angeles ').toLowerCase();
  return normalize(first) === normalize(second);
};
export const SEASONS = Object.freeze({
  // ESPN season year = year the season ends.
  2025: { label: '2024-25', role: 'DEVELOPMENT', start: '2024-10-20', end: '2024-12-20' },
  2026: { label: '2025-26', role: 'HOLDOUT', start: '2025-10-19', end: '2025-12-20' },
});

export async function json(url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { headers: { accept: 'application/json' } }).catch(() => null);
    if (response?.ok) return response.json();
    await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
  }
  return null;
}

/** Regular-season games where both teams had played at most WINDOW_GAMES games before tipoff. */
export async function windowGames(season) {
  const config = SEASONS[season];
  if (!config) throw new Error(`Unsupported season ${season}`);
  const played = new Map();
  const games = [];
  for (let date = new Date(`${config.start}T12:00:00Z`); date < new Date(`${config.end}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + 1)) {
    const board = await json(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date.toISOString().slice(0, 10).replaceAll('-', '')}`);
    const events = (board?.events ?? []).filter(event => event.season?.type === 2);
    for (const event of events) {
      const teams = event.competitions[0].competitors.map(team => team.team.displayName);
      if (teams.every(team => (played.get(team) ?? 0) <= WINDOW_GAMES)) games.push({ espnId: event.id, tipoff: event.date, teams });
    }
    for (const event of events) for (const team of event.competitions[0].competitors) played.set(team.team.displayName, (played.get(team.team.displayName) ?? 0) + 1);
    if (played.size >= 30 && [...played.values()].every(count => count > WINDOW_GAMES)) break;
  }
  return games;
}
