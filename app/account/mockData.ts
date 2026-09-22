export interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  username: string;
  memberSince: string;
  plan: string;
  planLabel: string;
  avatar: string;
}

export interface MembershipPlan {
  name: string;
  price: string;
  description: string;
  features: string[];
  highlight?: boolean;
}

export interface UsageStats {
  savedPicks: number;
  activeAlerts: number;
  researchViews: number;
  trackedPlayers: number;
}

export interface SessionItem {
  device: string;
  location: string;
  lastActive: string;
  current?: boolean;
}

export const user: UserProfile = {
  id: 'user-1',
  firstName: 'Lisandro',
  lastName: 'Rodrigues',
  email: 'lisandro@example.com',
  username: 'lisandro',
  memberSince: 'August 2026',
  plan: 'Pro',
  planLabel: 'DeepSide Pro',
  avatar: 'LR',
};

export const membershipPlans: MembershipPlan[] = [
  {
    name: 'Free',
    price: '$0',
    description: 'For casual research and daily insights.',
    features: ['Basic research access', 'Limited saved picks', 'Community alerts'],
  },
  {
    name: 'Pro',
    price: '$19.99/month',
    description: 'For sharper edge tracking and team monitoring.',
    features: ['Unlimited saved picks', 'Advanced alerts', 'Full research history'],
    highlight: true,
  },
  {
    name: 'Elite',
    price: '$39.99/month',
    description: 'For power users who want deeper analysis.',
    features: ['Everything in Pro', 'Priority alert routing', 'Advanced prop modeling'],
  },
];

export const usage: UsageStats = {
  savedPicks: 12,
  activeAlerts: 7,
  researchViews: 84,
  trackedPlayers: 9,
};

export const sessions: SessionItem[] = [
  {
    device: 'MacBook Air',
    location: 'San Diego, CA',
    lastActive: 'Current session',
    current: true,
  },
  {
    device: 'iPhone',
    location: 'San Diego, CA',
    lastActive: 'Last active 2 hours ago',
  },
];

export const notificationDefaults = {
  lineMovementAlerts: true,
  oddsMovementAlerts: true,
  lineupConfirmations: true,
  startingPitcherChanges: true,
  weatherAlerts: true,
  injuryAlerts: true,
  propRemoved: true,
  confidenceChanges: true,
};

export const sportsDefaults = {
  favoriteSports: ['MLB'],
  favoriteTeams: ['Yankees', 'Dodgers'],
};

export const oddsDefaults = {
  oddsFormat: 'American',
  sportsbooks: ['DraftKings', 'FanDuel', 'BetMGM', 'Caesars', 'ESPN BET'],
};

export const displayDefaults = {
  compactMode: true,
  showPlayerImages: true,
  showTeamLogos: true,
  animations: true,
  showConfidenceColors: true,
  theme: 'Dark',
};

export const researchDefaults = {
  defaultRange: 'L10',
  defaultSide: 'Over',
};

export const alertPreferencesDefaults = {
  soundAlerts: true,
  browserNotifications: true,
  emailAlerts: true,
};

export const privacyDefaults = {
  profileVisibility: 'Friends',
  analyticsPreference: 'On',
  personalizedRecommendations: true,
};
