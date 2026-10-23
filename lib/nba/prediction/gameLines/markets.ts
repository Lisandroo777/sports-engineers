import type { GameProjection, GameQuote, MarketAssessment, QuoteBinding, ScoreScenario } from './types';
import { GAME_MODEL_VERSION } from './types';
import { validAmericanPrice } from './quotes';

export function settleGameQuote(score: Pick<ScoreScenario, 'homeScore' | 'awayScore'>, quote: GameQuote): 'WIN' | 'LOSS' | 'PUSH' {
  let difference: number;
  if (quote.market === 'MONEYLINE') difference = quote.selection === 'HOME' ? score.homeScore - score.awayScore : score.awayScore - score.homeScore;
  else if (quote.market === 'SPREAD') difference = (quote.selection === 'HOME' ? score.homeScore - score.awayScore : score.awayScore - score.homeScore) + quote.line!;
  else {
    const value = quote.market === 'TOTAL' ? score.homeScore + score.awayScore : quote.team === 'HOME' ? score.homeScore : score.awayScore;
    difference = quote.selection === 'OVER' ? value - quote.line! : quote.line! - value;
  }
  return difference === 0 ? 'PUSH' : difference > 0 ? 'WIN' : 'LOSS';
}

export function assessGameMarket(model: GameProjection, quote: GameQuote | null, binding: QuoteBinding): MarketAssessment {
  const empty: MarketAssessment = { status: 'UNAVAILABLE_MODEL', reason: null, quote, winProbability: null, lossProbability: null,
    pushProbability: null, conditionalWinProbability: null, impliedProbability: null, fairAmericanOdds: null, evPercent: null,
    modelVersion: GAME_MODEL_VERSION, validationStatus: 'UNVALIDATED' };
  if (!quote) return { ...empty, status: 'UNSUPPORTED_QUOTE', reason: 'Actual timestamped game-line quote unavailable' };
  if (model.status !== 'AVAILABLE' || !model.scenarios.length) return { ...empty, reason: `Game projection ${model.status}` };
  if (quote.provider !== 'THE_ODDS_API' || quote.period !== 'FULL_GAME' || !validAmericanPrice(quote.americanOdds)
    || !['MONEYLINE', 'SPREAD', 'TOTAL', 'TEAM_TOTAL'].includes(quote.market)
    || (['MONEYLINE', 'SPREAD'].includes(quote.market) ? !['HOME', 'AWAY'].includes(quote.selection) : !['OVER', 'UNDER'].includes(quote.selection))
    || quote.market === 'MONEYLINE' && quote.line !== null
    || quote.market !== 'MONEYLINE' && (quote.line == null || !Number.isFinite(quote.line) || !Number.isInteger(quote.line * 2))
    || quote.market === 'TEAM_TOTAL' && !['HOME', 'AWAY'].includes(quote.team ?? '')) return { ...empty, status: 'UNSUPPORTED_QUOTE', reason: 'Unsupported market, period, side, line or price' };
  if (binding.sourceGameId !== model.gameId || binding.eventId !== quote.eventId || binding.homeTeam !== quote.homeTeam
    || binding.awayTeam !== quote.awayTeam || !(Math.abs(Date.parse(quote.commenceTime) - Date.parse(model.startsAt)) <= 15 * 60000)) return { ...empty, status: 'IDENTITY_MISMATCH', reason: 'Game, event, side identity or scheduled tipoff mismatch' };
  const predictionTime = Date.parse(model.predictionAt);
  const updateTime = Date.parse(quote.updatedAt);
  const observedTime = Date.parse(quote.observedAt);
  if (!Number.isFinite(updateTime) || !Number.isFinite(observedTime) || updateTime > observedTime || observedTime > predictionTime
    || updateTime > predictionTime || predictionTime - updateTime > 3600000) return { ...empty, status: 'STALE_QUOTE', reason: 'Missing, future-observed or stale quote provenance' };
  let win = 0; let loss = 0; let push = 0;
  for (const scenario of model.scenarios) {
    const outcome = settleGameQuote(scenario, quote);
    if (outcome === 'WIN') win += scenario.weight;
    else if (outcome === 'LOSS') loss += scenario.weight;
    else push += scenario.weight;
  }
  const total = win + loss + push;
  win /= total; loss /= total; push /= total;
  const probability = win + loss > 0 ? win / (win + loss) : null;
  const price = quote.americanOdds;
  const payout = price > 0 ? price / 100 : 100 / -price;
  return { ...empty, status: 'PRICED', reason: null, winProbability: win, lossProbability: loss, pushProbability: push,
    conditionalWinProbability: probability, impliedProbability: price > 0 ? 100 / (price + 100) : -price / (-price + 100),
    fairAmericanOdds: probability == null || probability <= 0 || probability >= 1 ? null
      : Math.round(probability >= 0.5 ? -100 * probability / (1 - probability) : 100 * (1 - probability) / probability),
    evPercent: (win * payout - loss) * 100 };
}