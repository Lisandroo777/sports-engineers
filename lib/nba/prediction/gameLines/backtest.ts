import type { GameModelInput, GameQuote, QuoteBinding } from './types';
import { GAME_MODEL_VERSION } from './types';
import { projectNBAGame } from './model';
import { assessGameMarket, settleGameQuote } from './markets';
import { basketballDate } from '../../context/schedule';

export interface ArchivedGamePrediction {
  origin: 'SYNTHETIC_FIXTURE' | 'RECONSTRUCTED' | 'FORWARD';
  input: GameModelInput;
  binding: QuoteBinding;
  quote: GameQuote | null;
  outcome: {
    gameId: string;
    homeScore: number;
    awayScore: number;
    completedAt: string;
    observedAt: string;
    source: string;
    finalized: boolean;
  } | null;
}

function finalOutcomeValid(row: ArchivedGamePrediction, evaluationAt: string) {
  const outcome = row.outcome;
  if (!outcome || !outcome.finalized || !outcome.source.trim() || outcome.gameId !== row.input.snapshot.target.gameId
    || !Number.isInteger(outcome.homeScore) || !Number.isInteger(outcome.awayScore) || outcome.homeScore < 0 || outcome.awayScore < 0 || outcome.homeScore === outcome.awayScore) return false;
  const start = Date.parse(row.input.snapshot.target.startsAt);
  const completed = Date.parse(outcome.completedAt);
  const observed = Date.parse(outcome.observedAt);
  return Number.isFinite(completed) && Number.isFinite(observed) && completed > start && observed >= completed && observed <= Date.parse(evaluationAt);
}

export function backtestNBAGameLines(rows: ArchivedGamePrediction[], evaluationAt: string) {
  if (!Number.isFinite(Date.parse(evaluationAt))) throw new Error('Valid offline evaluation timestamp required');
  const seen = new Set<string>();
  const ledger = rows.map(row => {
    const model = projectNBAGame(row.input);
    const market = assessGameMarket(model, row.quote, row.binding);
    const key = JSON.stringify([row.origin, row.input.snapshot.target.gameId, row.input.predictionAt, row.quote]);
    const duplicate = seen.has(key); seen.add(key);
    const valid = finalOutcomeValid(row, evaluationAt);
    const grade = duplicate ? 'DUPLICATE' as const : market.status !== 'PRICED' || !valid ? 'UNGRADABLE' as const
      : settleGameQuote(row.outcome!, row.quote!);
    return { origin: row.origin, gameId: model.gameId, slateId: Number.isFinite(Date.parse(model.startsAt)) ? basketballDate(model.startsAt) : 'UNVERIFIED', predictionAt: model.predictionAt,
      market, grade, forecast: model.means, actual: valid ? row.outcome : null, duplicate,
      units: grade === 'WIN' ? row.quote!.americanOdds > 0 ? row.quote!.americanOdds / 100 : 100 / -row.quote!.americanOdds : grade === 'LOSS' ? -1 : 0 };
  });
  const summarize = (selected: typeof ledger) => {
    const settled = selected.filter(row => row.grade === 'WIN' || row.grade === 'LOSS' || row.grade === 'PUSH');
    const binary = settled.filter(row => row.grade !== 'PUSH');
    const probability = (row: typeof ledger[number]) => row.market.conditionalWinProbability!;
    const units = settled.reduce((sum, row) => sum + row.units, 0);
    const buckets = [0, 0.5, 0.6, 0.7, 0.8, 0.9].map((lower, index, edges) => {
      const upper = edges[index + 1] ?? 1.000001;
      const values = binary.filter(row => probability(row) >= lower && probability(row) < upper);
      return { lower, upper: Math.min(upper, 1), n: values.length,
        predicted: values.length ? values.reduce((sum, row) => sum + probability(row), 0) / values.length : null,
        observed: values.length ? values.filter(row => row.grade === 'WIN').length / values.length : null };
    });
    return { n: settled.length, independentGameN: new Set(settled.map(row => row.gameId)).size, binaryN: binary.length, wins: binary.filter(row => row.grade === 'WIN').length,
      losses: binary.filter(row => row.grade === 'LOSS').length, pushes: settled.filter(row => row.grade === 'PUSH').length,
      ungradable: selected.filter(row => row.grade === 'UNGRADABLE').length, units,
      roiPercent: binary.length ? units / binary.length * 100 : null,
      roiDenominator: 'WIN_PLUS_LOSS_UNIT_STAKES_PUSHES_EXCLUDED',
      brier: binary.length ? binary.reduce((sum, row) => sum + (probability(row) - Number(row.grade === 'WIN')) ** 2, 0) / binary.length : null,
      logLoss: binary.length ? binary.reduce((sum, row) => sum - Math.log(Math.max(1e-12, row.grade === 'WIN' ? probability(row) : 1 - probability(row))), 0) / binary.length : null,
      outcomeBrier: settled.length ? settled.reduce((sum, row) => sum + ([['WIN', row.market.winProbability], ['LOSS', row.market.lossProbability], ['PUSH', row.market.pushProbability]] as const)
        .reduce((total, [grade, chance]) => total + (chance! - Number(row.grade === grade)) ** 2, 0), 0) / settled.length : null,
      meanAbsoluteMarginError: settled.length ? settled.reduce((sum, row) => sum + Math.abs(row.forecast!.margin - (row.actual!.homeScore - row.actual!.awayScore)), 0) / settled.length : null,
      meanAbsoluteTotalError: settled.length ? settled.reduce((sum, row) => sum + Math.abs(row.forecast!.total - row.actual!.homeScore - row.actual!.awayScore), 0) / settled.length : null,
      buckets };
  };
  const origins = ['SYNTHETIC_FIXTURE', 'RECONSTRUCTED', 'FORWARD'] as const;
  const cohorts = Object.fromEntries(origins.map(origin => {
    const cohort = ledger.filter(row => row.origin === origin && !row.duplicate);
    const slates = [...new Map(cohort.map(row => [row.slateId, row.slateId])).values()].sort();
    const holdoutSlates = new Set(slates.slice(Math.floor(slates.length * 0.7)));
    const holdout = cohort.filter(row => holdoutSlates.has(row.slateId));
    return [origin, { all: summarize(cohort), developmentSlates: slates.length - holdoutSlates.size, holdoutSlates: holdoutSlates.size,
      holdout: summarize(holdout), byMarket: Object.fromEntries(['MONEYLINE', 'SPREAD', 'TOTAL', 'TEAM_TOTAL'].map(market => [market, summarize(holdout.filter(row => row.market.quote?.market === market))])) }];
  }));
  return { modelVersion: GAME_MODEL_VERSION, validationStatus: 'UNVALIDATED' as const, calibration: 'REPORT_ONLY_NOT_FITTED' as const,
    calibrationMethodology: 'Walk-forward as-of forecasts; chronological slate-grouped holdout, binary conditional and three-outcome scoring; no synthetic/reconstructed promotion to forward evidence.',
    cohorts, ledger };
}