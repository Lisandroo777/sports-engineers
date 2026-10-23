const NBA_TEAMS = [
  'Atlanta Hawks', 'Boston Celtics', 'Brooklyn Nets', 'Charlotte Hornets', 'Chicago Bulls', 'Cleveland Cavaliers',
  'Dallas Mavericks', 'Denver Nuggets', 'Detroit Pistons', 'Golden State Warriors', 'Houston Rockets', 'Indiana Pacers',
  'Los Angeles Clippers', 'Los Angeles Lakers', 'Memphis Grizzlies', 'Miami Heat', 'Milwaukee Bucks', 'Minnesota Timberwolves',
  'New Orleans Pelicans', 'New York Knicks', 'Oklahoma City Thunder', 'Orlando Magic', 'Philadelphia 76ers', 'Phoenix Suns',
  'Portland Trail Blazers', 'Sacramento Kings', 'San Antonio Spurs', 'Toronto Raptors', 'Utah Jazz', 'Washington Wizards',
];

export function requestedNBATeams(query: string): string[] {
  return NBA_TEAMS.filter(team => [team, team.split(' ').at(-1)!].some(alias => new RegExp(`\\b${alias}\\b`, 'i').test(query)));
}

export function matchesNBATeams(teams: string[], names: Array<string | null | undefined>): boolean {
  const normalized = names.filter((name): name is string => Boolean(name)).map(name => name.toLowerCase());
  const requested = teams.map(team => team.toLowerCase());
  return requested.every(team => normalized.includes(team))
    || (requested.length > 2 && normalized.length === 2 && normalized.every(name => requested.includes(name)));
}