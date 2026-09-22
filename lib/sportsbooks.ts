export interface SportsbookOffer {
  sportsbookId: string;
  sportsbookName: string;
  odds: number;
  line: number;
  available: boolean;
  updatedAt?: string;
}

export const supportedSportsbooks = [
  { id: 'draftkings', name: 'DraftKings', type: 'demo' },
  { id: 'fanduel', name: 'FanDuel', type: 'demo' },
  { id: 'fanatics', name: 'Fanatics', type: 'demo' },
  { id: 'betmgm', name: 'BetMGM', type: 'demo' },
  { id: 'caesars', name: 'Caesars', type: 'demo' },
] as const;
