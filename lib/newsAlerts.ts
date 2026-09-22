export type NewsAlertCategory = 'injury' | 'lineup' | 'pitcher' | 'weather' | 'market' | 'player' | 'game' | 'team';
export type NewsAlertPriority = 'critical' | 'important' | 'info';
export type NewsAlertSourceType = 'real' | 'projected' | 'mock';

export interface NewsAlert {
  id: string;
  category: NewsAlertCategory;
  priority: NewsAlertPriority;
  title: string;
  description: string;
  playerId?: string;
  playerName?: string;
  teamId?: string;
  teamName?: string;
  gameId?: string;
  createdAt: string;
  sourceType: NewsAlertSourceType;
  context?: string;
}

export const newsAlerts: NewsAlert[] = [
  {
    id: 'news-judge-lineup', category: 'lineup', priority: 'important',
    title: 'Yankees lineup confirmed', description: 'Aaron Judge is batting second against Boston.',
    playerId: '592450', playerName: 'Aaron Judge', teamId: '147', teamName: 'Yankees', gameId: 'red-sox-yankees', createdAt: '12 min ago', sourceType: 'mock', context: 'NYY vs BOS',
  },
  {
    id: 'news-yankees-wind', category: 'weather', priority: 'important',
    title: 'Wind increased at Yankee Stadium', description: 'Wind is now 14 mph out to right field.',
    teamId: '147', teamName: 'Yankees', gameId: 'red-sox-yankees', createdAt: '18 min ago', sourceType: 'mock', context: 'NYY vs BOS',
  },
  {
    id: 'news-ohtani-pitcher', category: 'pitcher', priority: 'critical',
    title: 'Dodgers starter changed', description: 'The projected starter changed ahead of first pitch.',
    playerId: '660271', playerName: 'Shohei Ohtani', teamId: '119', teamName: 'Dodgers', gameId: 'dodgers-giants', createdAt: '26 min ago', sourceType: 'mock', context: 'LAD vs SF',
  },
  {
    id: 'news-soto-market', category: 'market', priority: 'important',
    title: 'Total bases line moved', description: 'Juan Soto total bases odds moved from -105 to -135.',
    playerId: '665742', playerName: 'Juan Soto', teamId: '147', teamName: 'Yankees', createdAt: '34 min ago', sourceType: 'mock', context: 'Market movement',
  },
  {
    id: 'news-skenes-weather', category: 'weather', priority: 'info',
    title: 'Rain risk is holding', description: 'The current forecast keeps a low delay risk for tonight.',
    playerId: '694973', playerName: 'Paul Skenes', teamId: '134', teamName: 'Pirates', createdAt: '41 min ago', sourceType: 'mock', context: 'PIT game',
  },
  {
    id: 'news-red-sox-bullpen', category: 'team', priority: 'info',
    title: 'Bullpen workload elevated', description: 'Boston used three leverage arms in the previous game.',
    teamId: '111', teamName: 'Red Sox', createdAt: '52 min ago', sourceType: 'mock', context: 'Team news',
  },
  {
    id: 'news-mlb-injury', category: 'injury', priority: 'critical',
    title: 'Player status remains questionable', description: 'Lineup availability is still being monitored before lock.',
    teamName: 'MLB-wide', createdAt: '1 hr ago', sourceType: 'mock', context: 'Player status',
  },
  {
    id: 'news-mlb-game', category: 'game', priority: 'info',
    title: 'First pitch approaching', description: 'Several MLB games are starting within the next hour.',
    teamName: 'MLB', createdAt: '1 hr ago', sourceType: 'mock', context: 'Game status',
  },
];
