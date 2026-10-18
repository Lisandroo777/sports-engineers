export function withResponseDisplayRanks<Candidate extends { rank?: number }>(candidates: readonly Candidate[]): Candidate[] {
  return candidates.map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}