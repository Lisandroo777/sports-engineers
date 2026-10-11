import type { ResearchCandidateRecord } from '../ai/agent/session';

export interface NFLCorrelationGroup { id: string; label: string; kind: 'SAME_OUTCOME' | 'PASSING_ENVIRONMENT'; relatedPlays: number }

export function annotateNFLCorrelation(plays: ResearchCandidateRecord[]): ResearchCandidateRecord[] {
  const gameKey = (play: ResearchCandidateRecord) => play.gameId ?? play.eventId ?? [play.team, play.opponent].sort().join('|');
  const passing = (play: ResearchCandidateRecord) => play.marketKey.startsWith('player_pass_') || play.marketKey.startsWith('player_reception');
  return plays.map((play) => {
    const groups: NFLCorrelationGroup[] = [];
    const same = plays.filter((other) => gameKey(other) === gameKey(play) && other.team === play.team && (other.playerId ?? other.player) === (play.playerId ?? play.player)
      && other.marketKey === play.marketKey && other.direction === play.direction);
    if (same.length > 1) groups.push({ id: JSON.stringify([gameKey(play), play.playerId ?? play.player, play.marketKey, play.direction]),
      kind: 'SAME_OUTCOME', label: `${play.player}: different lines on the same outcome`, relatedPlays: same.length });
    const environment = passing(play) ? plays.filter((other) => passing(other) && gameKey(other) === gameKey(play) && other.team === play.team) : [];
    if (environment.length > 1) groups.push({ id: JSON.stringify([gameKey(play), play.team, 'passing-environment']), kind: 'PASSING_ENVIRONMENT',
      label: `${play.team ?? 'Team'} passing environment`, relatedPlays: environment.length });
    return { ...play, correlationGroups: groups };
  });
}