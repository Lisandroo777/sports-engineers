import type { NFLGame } from './types';
import { makeNFLResearchLayer, type NFLGameScriptResearch, type NFLResearchLayer, type NFLSourceProvenance } from './researchModel';
import { buildNFLGameEnvironment } from './gameEnvironment';

export function buildNFLGameScriptResearch(game: NFLGame, candidateTeamId: number | null, retrievedAt = new Date().toISOString(), market?: string, direction: 'over' | 'under' = 'over', options: Omit<Parameters<typeof buildNFLGameEnvironment>[0], 'market' | 'teamId' | 'gameScript' | 'direction'> = {}): NFLResearchLayer<NFLGameScriptResearch> {
  const gameOdds = game.odds?.find((entry) => entry.homeSpread != null || entry.total != null) ?? null;
  const homeAway = candidateTeamId === game.homeTeam.id ? 'HOME' : candidateTeamId === game.awayTeam.id ? 'AWAY' : null;
  const homeSpread = gameOdds?.homeSpread != null && Number.isFinite(gameOdds.homeSpread) ? gameOdds.homeSpread : null;
  const total = gameOdds?.total != null && Number.isFinite(gameOdds.total) && gameOdds.total > 0 ? gameOdds.total : null;
  const expectedLeader = homeSpread == null ? null : homeSpread < 0 ? game.homeTeam.displayName : homeSpread > 0 ? game.awayTeam.displayName : null;
  const homeTeamTotal = total != null && homeSpread != null && Math.abs(homeSpread) <= total ? Number(((total - homeSpread) / 2).toFixed(1)) : null;
  const awayTeamTotal = total != null && homeSpread != null && Math.abs(homeSpread) <= total ? Number(((total + homeSpread) / 2).toFixed(1)) : null;
  const evidence: string[] = [`Scheduled ${homeAway === 'HOME' ? 'home' : homeAway === 'AWAY' ? 'away' : 'unknown-side'} at ${game.venue?.name ?? 'venue unavailable'}.`];
  if (gameOdds && homeSpread != null) evidence.push(`${gameOdds.provider} game spread implies ${expectedLeader ?? 'no side'} as a market favorite by ${Math.abs(homeSpread)} points; this is not a certainty.`);
  if (gameOdds && total != null) evidence.push(`${gameOdds.provider} game total is ${total}${homeTeamTotal != null && awayTeamTotal != null ? `; derived team totals are ${game.homeTeam.displayName} ${homeTeamTotal} and ${game.awayTeam.displayName} ${awayTeamTotal}` : ''}.`);
  const candidateIsFavorite = expectedLeader != null && (candidateTeamId === game.homeTeam.id ? homeSpread! < 0 : candidateTeamId === game.awayTeam.id && homeSpread! > 0);
  const candidateEvidence = null;
  const thesis = homeSpread == null
    ? 'Market-implied game script is unavailable; no spread-based leader is inferred.'
    : homeAway == null ? `${expectedLeader ?? 'Neither side'} is market-favored, but the candidate team is unknown; no player-specific score-state inference is made.`
      : homeSpread === 0 ? 'The market spread is pick-em; no expected leader is inferred. Score-state behavior remains conditional and unmeasured.'
      : `${expectedLeader} is market-favored, not certain to lead. ${candidateIsFavorite ? 'If this team leads late, rushing opportunity may rise; if it trails, pass attempts may rise.' : 'If this team trails, pass attempts may rise; if it leads late, rushing opportunity may rise.'}`;
  const value: NFLGameScriptResearch = {
    thesis,
    expectedGameEnvironment: total == null ? 'UNKNOWN' : 'MARKET_TOTAL_AVAILABLE',
    expectedLeader,
    expectedMarginRange: { low: null, high: null, marketSpread: homeSpread == null ? null : Math.abs(homeSpread) },
    expectedPassPressure: homeSpread == null ? 'UNKNOWN' : 'HIGHER_IF_TRAILING',
    expectedRushOpportunity: homeSpread == null ? 'UNKNOWN' : 'HIGHER_IF_LEADING',
    spread: homeSpread,
    total,
    homeTeamTotal,
    awayTeamTotal,
    homeAway,
    expectedPossessions: null,
    offensivePace: null,
    neutralPassRate: null,
    neutralRushRate: null,
    noHuddleRate: null,
    situationalTendencies: {},
    projectionImpact: 'Conditional market-implied script only; no numeric projection adjustment is calibrated.',
    confidence: gameOdds && homeSpread != null ? 'LOW' : 'UNKNOWN',
    evidence,
    candidateEvidence,
  };
  const provenance: NFLSourceProvenance[] = gameOdds ? [{ source: `ESPN game odds · ${gameOdds.provider}`, sourceType: 'SPORTSBOOK',
    publishedAt: null, retrievedAt: gameOdds.retrievedAt ?? retrievedAt, affectedPlayer: null, affectedTeam: expectedLeader }] : [];
  const layer = makeNFLResearchLayer(gameOdds && (homeSpread != null || total != null) ? 'PARTIAL_DATA' : 'UNAVAILABLE', value,
    [...(homeSpread == null ? ['spread / expected leader'] : []), ...(total == null ? ['game total / derived team totals'] : []),
      'expected possessions', 'neutral pass/rush rates', 'leading/trailing tendencies'], provenance);
  const environmentModel = buildNFLGameEnvironment({ ...options, market: market ?? 'UNAVAILABLE', teamId: candidateTeamId,
    direction, season: options.season ?? game.season, gameScript: layer, now: options.now ?? new Date(retrievedAt) });
  value.environmentModel = environmentModel;
  value.confidence = environmentModel.confidence;
  layer.missingFields = [...new Set([...layer.missingFields, ...environmentModel.missingInputs])];
  return layer;
}