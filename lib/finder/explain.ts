import type { HistoricalSignal } from './signals';
import type { MatchupSignal } from './matchup';

export interface FinderExplanation {
  signals: string[];
  concerns: string[];
}

export function buildExplanation(params: {
  player: string;
  marketLabel: string;
  side: 'over' | 'under';
  line: number;
  historical: HistoricalSignal;
  matchup: MatchupSignal;
  evPercent: number | null;
  bestBookName: string | null;
  isBestPrice: boolean;
  availableBooks: number;
}): FinderExplanation {
  const signals: string[] = [];
  const concerns: string[] = [];
  const sideLabel = params.side === 'over' ? 'cleared' : 'stayed under';

  if (params.historical.available) {
    const l10 = params.historical.windows.l10;
    const l20 = params.historical.windows.l20;
    if (l10.rate != null) signals.push(`${params.player} has ${sideLabel} this line in ${l10.hits} of his last ${l10.total} games (L10).`);
    if (l20.rate != null && l20.rate >= 60) signals.push(`Strong L20 performance at ${l20.rate}%.`);
    if (params.historical.trend === 'up') signals.push('Recent trend is moving upward over the sample.');
    if (params.historical.trend === 'down') concerns.push('Recent trend is moving downward over the sample.');
    if (params.historical.consistency != null && params.historical.seasonAverage != null && params.historical.consistency > params.historical.seasonAverage) {
      concerns.push('Game-to-game variance is high relative to the season average.');
    }
  } else {
    concerns.push('Historical game-log analysis is not yet available for this market.');
  }

  if (params.matchup.available && params.matchup.opposingPitcher?.era != null) {
    signals.push(`Opposing starter carries a ${params.matchup.opposingPitcher.era.toFixed(2)} ERA this season.`);
  }

  if (params.evPercent != null && params.evPercent > 0) {
    signals.push(`Positive Market Consensus EV of +${params.evPercent.toFixed(1)}%.`);
  } else if (params.evPercent != null) {
    concerns.push(`Market Consensus EV is currently ${params.evPercent.toFixed(1)}%.`);
  }

  if (params.isBestPrice && params.bestBookName) {
    signals.push(`${params.bestBookName} currently offers the best available price across ${params.availableBooks} book(s).`);
  }

  if (params.availableBooks < 2) {
    concerns.push('Limited sportsbook coverage; consensus is based on few books.');
  }

  return { signals, concerns };
}
