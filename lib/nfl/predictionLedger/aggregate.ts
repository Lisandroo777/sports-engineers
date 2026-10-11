import { americanNetPayout } from './core';
import type { NFLPredictionRecord } from './types';

export const PROBABILITY_BUCKETS = [
  { label: '50-59%', min: 0.5, max: 0.6 },
  { label: '60-69%', min: 0.6, max: 0.7 },
  { label: '70-79%', min: 0.7, max: 0.8 },
  { label: '80-89%', min: 0.8, max: 0.9 },
  { label: '90%+', min: 0.9, max: Infinity },
] as const;

export interface NFLRecordStats {
  sampleSize: number;
  wins: number;
  losses: number;
  pushes: number;
  hitRate: number | null;
  averageOdds: number | null;
  units: number;
  roiPercent: number | null;
  averagePredictedProbability: number | null;
  actualHitRate: number | null;
}

function validForward(records: NFLPredictionRecord[]): NFLPredictionRecord[] {
  return records.filter(({ snapshot }) => snapshot.origin === 'FORWARD' && snapshot.pregameStatus === 'PREGAME_VALID');
}

function graded(records: NFLPredictionRecord[]) {
  return records.filter(({ currentGrade }) => currentGrade === 'WIN' || currentGrade === 'LOSS' || currentGrade === 'PUSH');
}

export function summarize(records: NFLPredictionRecord[]): NFLRecordStats {
  const binary = graded(validForward(records)).filter(({ currentGrade }) => currentGrade === 'WIN' || currentGrade === 'LOSS');
  const wins = binary.filter(({ currentGrade }) => currentGrade === 'WIN').length;
  const losses = binary.length - wins;
  const pushes = graded(validForward(records)).filter(({ currentGrade }) => currentGrade === 'PUSH').length;
  const units = binary.reduce((total, { snapshot, currentGrade }) => total + (currentGrade === 'WIN' ? americanNetPayout(snapshot.americanOdds) : -1), 0);
  const odds = binary.map(({ snapshot }) => snapshot.americanOdds);
  const probabilities = binary.map(({ snapshot }) => snapshot.displayedProbability).filter((value): value is number => value != null && Number.isFinite(value));
  const hitRate = binary.length ? wins / binary.length : null;
  return {
    sampleSize: binary.length, wins, losses, pushes, hitRate,
    averageOdds: odds.length ? odds.reduce((sum, value) => sum + value, 0) / odds.length : null,
    units, roiPercent: binary.length ? units / binary.length * 100 : null,
    averagePredictedProbability: probabilities.length ? probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length : null,
    actualHitRate: hitRate,
  };
}

function group(records: NFLPredictionRecord[], key: (record: NFLPredictionRecord) => string) {
  const groups = new Map<string, NFLPredictionRecord[]>();
  for (const record of validForward(records)) groups.set(key(record), [...(groups.get(key(record)) ?? []), record]);
  return Object.fromEntries([...groups].sort(([a], [b]) => a.localeCompare(b)).map(([name, values]) => [name, summarize(values)]));
}

export function buildNFLPerformanceReport(all: NFLPredictionRecord[]) {
  const records = validForward(all);
  const overall = summarize(records);
  const gradedRecords = graded(records).filter(({ currentGrade }) => currentGrade === 'WIN' || currentGrade === 'LOSS');
  const brierValues = gradedRecords.filter(({ currentActual }) => currentActual != null).map(({ snapshot, currentGrade }) => {
    const probability = snapshot.displayedProbability;
    if (probability == null) return null;
    return (probability - (currentGrade === 'WIN' ? 1 : 0)) ** 2;
  }).filter((value): value is number => value != null);
  const buckets = Object.fromEntries(PROBABILITY_BUCKETS.map((bucket) => [bucket.label, summarize(records.filter(({ snapshot }) => {
    const probability = snapshot.displayedProbability;
    return probability != null && probability >= bucket.min && probability < bucket.max;
  }))]));
  const nuke = summarize(records.filter(({ snapshot }) => snapshot.tier === 'NUKE'));
  return {
    scope: 'GLOBAL' as const,
    modelVersion: 'NFL_MODEL_V1_1_HARDENED' as const,
    overall,
    counts: {
      totalForwardPregame: records.length,
      graded: records.filter(({ currentGrade }) => ['WIN', 'LOSS', 'PUSH'].includes(currentGrade)).length,
      pending: records.filter(({ currentGrade }) => currentGrade === 'PENDING').length,
      void: records.filter(({ currentGrade }) => currentGrade === 'VOID').length,
      ungradable: records.filter(({ currentGrade }) => currentGrade === 'UNGRADABLE').length,
      excludedPostKickoff: all.filter(({ snapshot }) => snapshot.pregameStatus === 'POST_KICKOFF').length,
      excludedKickoffUnverified: all.filter(({ snapshot }) => snapshot.pregameStatus === 'KICKOFF_UNVERIFIED').length,
    },
    byTier: group(records, ({ snapshot }) => snapshot.tier),
    byMarket: group(records, ({ snapshot }) => snapshot.market),
    byDirection: group(records, ({ snapshot }) => snapshot.direction.toUpperCase()),
    byMode: group(records, ({ snapshot }) => snapshot.researchMode),
    byRankingIntent: group(records, ({ snapshot }) => snapshot.rankingIntent),
    bySeasonPhase: group(records, ({ snapshot }) => snapshot.seasonPhase),
    probabilityBuckets: buckets,
    nuke: { ...nuke, separateFromOverall: true },
    standardVsDeep: { STANDARD: group(records, ({ snapshot }) => snapshot.researchMode).STANDARD ?? summarize([]), DEEP: group(records, ({ snapshot }) => snapshot.researchMode).DEEP ?? summarize([]) },
    calibration: {
      status: 'OFFLINE_ONLY_UNVALIDATED' as const,
      sampleSize: brierValues.length,
      meanSquaredError: brierValues.length ? brierValues.reduce((sum, value) => sum + value, 0) / brierValues.length : null,
      byProbabilityBucket: Object.fromEntries(PROBABILITY_BUCKETS.map((bucket) => {
        const rows = gradedRecords.filter(({ snapshot, currentGrade }) => snapshot.displayedProbability != null
          && snapshot.displayedProbability >= bucket.min && snapshot.displayedProbability < bucket.max
          && (currentGrade === 'WIN' || currentGrade === 'LOSS'));
        const predicted = rows.filter(({ snapshot }) => snapshot.displayedProbability != null);
        return [bucket.label, { sampleSize: rows.length, averagePredictedProbability: predicted.length ? predicted.reduce((sum, row) => sum + row.snapshot.displayedProbability!, 0) / predicted.length : null,
          actualHitRate: rows.length ? rows.filter(({ currentGrade }) => currentGrade === 'WIN').length / rows.length : null }];
      })),
    },
    sampleWarning: overall.sampleSize < 30 ? 'Insufficient sample for an accuracy claim. Results are descriptive only.' : 'Forward sample; not independently validated.',
  };
}

export function recentPublicRows(records: NFLPredictionRecord[]) {
  return validForward(records).slice(0, 50).map(({ snapshot, currentGrade, currentActual }) => ({
    predictionId: snapshot.predictionId, createdAt: snapshot.createdAt, player: snapshot.player, market: snapshot.market,
    direction: snapshot.direction, line: snapshot.line, odds: snapshot.americanOdds, tier: snapshot.tier,
    probability: snapshot.displayedProbability, actual: currentActual, grade: currentGrade,
  }));
}
