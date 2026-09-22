'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { SportsbookOffer } from '../lib/sportsbooks';

export interface SavedPick {
  id: string;
  playerId: string;
  playerName: string;
  playerImage?: string;
  teamId: string;
  teamName: string;
  opponentId?: string;
  opponentName: string;
  gameId: string;
  gameTime: string;
  propType: string;
  side: 'over' | 'under';
  line: number;
  savedAt: string;
  savedOdds: number;
  currentOdds?: number;
  sportsbooks: SportsbookOffer[];
}

interface PicksContextValue {
  picks: SavedPick[];
  isOpen: boolean;
  openPicks: () => void;
  closePicks: () => void;
  togglePicks: () => void;
  addPick: (pick: Omit<SavedPick, 'savedAt' | 'sportsbooks'> & { sportsbooks?: SportsbookOffer[] }) => void;
  removePick: (id: string) => void;
  hasPick: (id: string) => boolean;
}

const PicksContext = createContext<PicksContextValue | null>(null);
const STORAGE_KEY = 'sports-engineers-my-picks';

function demoOffers(line: number, odds: number): SportsbookOffer[] {
  return [
    { sportsbookId: 'draftkings', sportsbookName: 'DraftKings', odds: odds + 5, line, available: true, updatedAt: 'demo' },
    { sportsbookId: 'fanduel', sportsbookName: 'FanDuel', odds, line, available: true, updatedAt: 'demo' },
    { sportsbookId: 'fanatics', sportsbookName: 'Fanatics', odds: odds + 3, line, available: true, updatedAt: 'demo' },
    { sportsbookId: 'betmgm', sportsbookName: 'BetMGM', odds: odds - 5, line, available: true, updatedAt: 'demo' },
    { sportsbookId: 'caesars', sportsbookName: 'Caesars', odds: odds + 1, line, available: true, updatedAt: 'demo' },
  ];
}

export function PicksProvider({ children }: { children: ReactNode }) {
  const [picks, setPicks] = useState<SavedPick[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored) setPicks(JSON.parse(stored) as SavedPick[]);
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    } finally {
      setIsHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(picks));
  }, [isHydrated, picks]);

  const value = useMemo<PicksContextValue>(() => ({
    picks,
    isOpen,
    openPicks: () => setIsOpen(true),
    closePicks: () => setIsOpen(false),
    togglePicks: () => setIsOpen((open) => !open),
    addPick: (pick) => setPicks((current) => {
      if (current.some((item) => item.id === pick.id)) return current;
      return [...current, { ...pick, savedAt: new Date().toISOString(), sportsbooks: pick.sportsbooks ?? demoOffers(pick.line, pick.savedOdds) }];
    }),
    removePick: (id) => setPicks((current) => current.filter((pick) => pick.id !== id)),
    hasPick: (id) => picks.some((pick) => pick.id === id),
  }), [isOpen, picks]);

  return <PicksContext.Provider value={value}>{children}</PicksContext.Provider>;
}

export function usePicks() {
  const context = useContext(PicksContext);
  if (!context) throw new Error('usePicks must be used within PicksProvider');
  return context;
}
