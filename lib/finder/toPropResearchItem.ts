import type { FinderResult } from './engine';
import type { PropResearchItem } from '../../app/research/mockData';

/** Converts a real FinderResult into the existing PropResearchItem shape so list/AI UIs need no redesign. Detail-only fields (gameLog/splits/matchup/aiAnalysis) are honestly marked unavailable since these views never render them. */
export function finderResultToListItem(result: FinderResult): PropResearchItem {
  const grade = result.grade ?? (result.finderScore >= 60 ? 'Average' : 'Low');
  const confidenceLabel: PropResearchItem['confidenceLabel'] = grade === 'Elite' || grade === 'Strong' ? 'Strong' : grade === 'Good' ? 'Good' : 'Moderate';
  const oddsDisplay = result.bestBook ? (result.bestBook.odds > 0 ? `+${result.bestBook.odds}` : `${result.bestBook.odds}`) : 'Unavailable';
  return {
    id: result.id,
    isLive: true,
    marketKey: result.marketKey,
    hasSportsbookLine: Boolean(result.bestBook),
    sportsbookName: result.bestBook?.sportsbookName,
    oddsLastUpdate: undefined,
    sport: result.sport ?? 'mlb',
    player: result.player,
    playerId: result.playerId ?? undefined,
    team: result.teamName ?? 'Data unavailable',
    teamId: result.teamId ?? undefined,
    opponent: result.opponentName ?? 'Data unavailable',
    homeAway: result.homeAway === 'home' ? 'Home' : result.homeAway === 'away' ? 'Away' : undefined,
    propType: result.marketLabel,
    line: String(result.line),
    overOdds: result.side === 'over' ? oddsDisplay : (result.bestBook ? 'Unavailable' : 'Unavailable'),
    underOdds: result.side === 'under' ? oddsDisplay : (result.bestBook ? 'Unavailable' : 'Unavailable'),
    projectedValue: result.evPercent ?? 0,
    confidence: result.finderScore,
    confidenceLabel,
    gameTime: result.gameTimeIso ? new Date(result.gameTimeIso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Data unavailable',
    researchSide: result.side === 'over' ? 'Over' : 'Under',
    last5: result.historical.l5Rate != null ? `${result.historical.l5Rate}%` : '\u2014',
    last10: result.historical.l10Rate != null ? `${result.historical.l10Rate}%` : '\u2014',
    last20: result.historical.l20Rate != null ? `${result.historical.l20Rate}%` : '\u2014',
    last40: '\u2014',
    season: result.historical.seasonRate != null ? `${result.historical.seasonRate}%` : '\u2014',
    hitRates: {
      last5: result.historical.l5Rate ?? -1,
      last10: result.historical.l10Rate ?? -1,
      last20: result.historical.l20Rate ?? -1,
      last40: -1,
      season: result.historical.seasonRate ?? -1,
    },
    gameLog: [],
    splits: { home: 'Data unavailable', away: 'Data unavailable', similarOpponents: 'Data unavailable', recent5: 'Data unavailable', recent10: 'Data unavailable' },
    matchup: { opponentDefensiveRanking: 'Data unavailable', opponentAllowedAverage: 'Data unavailable', paceEnvironment: 'Data unavailable', difficulty: 'Data unavailable', recentHistory: 'Data unavailable' },
    researchFactors: [],
    aiAnalysis: { summary: 'Data unavailable', risks: 'Data unavailable', lean: 'Data unavailable' },
    rationale: result.signals[0] ?? undefined,
  };
}
