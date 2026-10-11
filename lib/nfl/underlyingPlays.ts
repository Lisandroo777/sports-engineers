import type { ResearchCandidateRecord } from '../ai/agent/session';

export interface NFLSportsbookPrice {
  candidateId: string;
  sportsbook: string | null;
  odds: number;
  eliteQualified: boolean;
}

export function nflUnderlyingPlayKey(candidate: ResearchCandidateRecord): string {
  return JSON.stringify([candidate.playerId ?? candidate.player.toLowerCase(), candidate.gameId ?? candidate.eventId
    ?? [candidate.team, candidate.opponent].sort().join('|'), candidate.marketKey, candidate.direction, candidate.line]);
}

export function assignNFLDisplayRanks(plays: ResearchCandidateRecord[]): ResearchCandidateRecord[] {
  return plays.map((play, index) => ({ ...play, rank: index + 1 }));
}

export function groupNFLUnderlyingPlays(eligible: ResearchCandidateRecord[], universe = eligible): ResearchCandidateRecord[] {
  const groups = new Map<string, ResearchCandidateRecord[]>();
  for (const candidate of eligible) {
    const key = nflUnderlyingPlayKey(candidate);
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }
  return [...groups].map(([key, rows]) => {
    const primary = [...rows].sort((first, second) => (second.odds ?? -Infinity) - (first.odds ?? -Infinity)
      || first.candidateId.localeCompare(second.candidateId))[0];
    const books = new Map<string, NFLSportsbookPrice>();
    for (const candidate of universe.filter((entry) => nflUnderlyingPlayKey(entry) === key && entry.odds != null && entry.priceCurrent !== false)) {
      const price = { candidateId: candidate.candidateId, sportsbook: candidate.book, odds: candidate.odds!, eliteQualified: candidate.eliteQualified === true };
      const current = books.get(candidate.book ?? candidate.candidateId);
      if (!current || price.odds > current.odds) books.set(candidate.book ?? candidate.candidateId, price);
    }
    for (const price of primary.availablePrices ?? []) {
      const current = books.get(price.sportsbook ?? price.candidateId);
      if (!current || price.odds > current.odds) books.set(price.sportsbook ?? price.candidateId, price);
    }
    const prices = [...books.values()].sort((first, second) => second.odds - first.odds || first.candidateId.localeCompare(second.candidateId));
    return { ...primary, underlyingPlayId: key, availableBooks: prices.length, availablePrices: prices };
  });
}