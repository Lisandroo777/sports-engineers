import { MLBDataUnavailableError, mlbFetch } from './client';
import type { HitRateResult, MLBGameLog, MLBRange, PropMarket, PropSide } from './types';

/** Returns null when the raw value is genuinely absent — never masks missing data as 0. */
function toNumberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const num = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(num) ? num : null;
}

function toDateValue(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }

  if (value && typeof value === 'object' && 'date' in value) {
    const dateValue = value as Record<string, unknown>;
    return typeof dateValue.date === 'string' ? dateValue.date : '';
  }

  return '';
}

/**
 * Pure raw-JSON -> MLBGameLog mapping, extracted so the exact field-name mapping can be regression
 * tested against real captured MLB Stats API responses without any network call. This is the exact
 * point where a prior bug (`strikeouts`/`walks`/`pitches` instead of the real `strikeOuts`/
 * `baseOnBalls`/`numberOfPitches`) silently turned every strikeout total into 0.
 */
export function mapRawGameLogSplit(split: Record<string, unknown>, group: 'pitching' | 'hitting'): MLBGameLog {
  const stat = (split.stat as Record<string, unknown>) ?? {};
  const opponent = String((split.opponent as Record<string, unknown> | undefined)?.name ?? 'TBD');
  const homeAway = String(split.homeAway ?? '');
  const date = String(toDateValue(split.date) || split.date || '');

  if (group === 'pitching') {
    return {
      date,
      opponent,
      homeAway,
      inningsPitched: toNumberOrNull(stat.inningsPitched),
      hitsAllowed: toNumberOrNull(stat.hits),
      earnedRuns: toNumberOrNull(stat.earnedRuns),
      // MLB Stats API field is `baseOnBalls`, not `walks` — a prior mismatch silently returned 0 for every game.
      walks: toNumberOrNull(stat.baseOnBalls),
      // MLB Stats API field is `strikeOuts` (capital O), not `strikeouts` — same silent-zero bug, affecting every hitter and pitcher.
      strikeouts: toNumberOrNull(stat.strikeOuts),
      homeRunsAllowed: toNumberOrNull(stat.homeRuns),
      pitches: toNumberOrNull(stat.numberOfPitches),
    } satisfies MLBGameLog;
  }

  return {
    date,
    opponent,
    homeAway,
    plateAppearances: toNumberOrNull(stat.plateAppearances),
    atBats: toNumberOrNull(stat.atBats),
    hits: toNumberOrNull(stat.hits),
    doubles: toNumberOrNull(stat.doubles),
    triples: toNumberOrNull(stat.triples),
    homeRuns: toNumberOrNull(stat.homeRuns),
    runs: toNumberOrNull(stat.runs),
    rbi: toNumberOrNull(stat.rbi),
    walks: toNumberOrNull(stat.baseOnBalls),
    strikeouts: toNumberOrNull(stat.strikeOuts),
    totalBases: toNumberOrNull(stat.totalBases),
  } satisfies MLBGameLog;
}

export async function getPlayerGameLogs(playerId: string | number, season: number): Promise<MLBGameLog[]> {
  const id = typeof playerId === 'string' ? Number(playerId) : playerId;

  if (!id) {
    return [];
  }

  try {
    const player = await import('./players').then((module) => module.getMLBPlayer(id));
    const isPitcher = player.position?.toUpperCase().includes('P');
    const group = isPitcher ? 'pitching' : 'hitting';
    const payload = await mlbFetch<{ stats?: Array<{ splits?: Array<Record<string, unknown>> }> }>(`/people/${id}/stats?stats=gameLog&group=${group}&season=${season}`, {
      revalidate: 3600,
    });

    const splits = payload.stats?.[0]?.splits ?? [];
    return splits.map((split) => mapRawGameLogSplit(split, group));
  } catch (error) {
    console.error('[mlb] Unable to load player game logs.', error);
    throw error instanceof MLBDataUnavailableError ? error : new MLBDataUnavailableError();
  }
}

export function calculateHits(game: MLBGameLog) {
  return game.hits ?? null;
}

export function calculateTotalBases(game: MLBGameLog) {
  if (game.hits == null || game.doubles == null || game.triples == null || game.homeRuns == null) return null;
  return game.hits + game.doubles + 2 * game.triples + 3 * game.homeRuns;
}

export function calculateHomeRuns(game: MLBGameLog) {
  return game.homeRuns ?? null;
}

export function calculateRuns(game: MLBGameLog) {
  return game.runs ?? null;
}

export function calculateRBI(game: MLBGameLog) {
  return game.rbi ?? null;
}

export function calculateHitsRunsRBI(game: MLBGameLog) {
  if (game.hits == null || game.runs == null || game.rbi == null) return null;
  return game.hits + game.runs + game.rbi;
}

export function calculateStrikeouts(game: MLBGameLog) {
  return game.strikeouts ?? null;
}

export function calculateOutsRecorded(inningsPitched: number | string | null | undefined) {
  if (inningsPitched == null) return null;
  const innings = String(inningsPitched);
  const [wholeInnings, fractionalOuts = '0'] = innings.split('.');
  const whole = Number(wholeInnings);
  const outs = Number(fractionalOuts);
  if (!Number.isInteger(whole) || !Number.isInteger(outs) || outs < 0 || outs > 2) return null;
  return whole * 3 + outs;
}

function selectGames(games: MLBGameLog[], sampleSize: MLBRange) {
  if (sampleSize === 'L5') {
    return games.slice(0, 5);
  }

  if (sampleSize === 'L10') {
    return games.slice(0, 10);
  }

  if (sampleSize === 'L20') {
    return games.slice(0, 20);
  }

  if (sampleSize === 'L40') {
    return games.slice(0, 40);
  }

  const year = sampleSize === '2026' ? '2026' : '2025';
  return games.filter((game) => game.date.startsWith(year));
}

function getPropMetric(game: MLBGameLog, market: PropMarket) {
  if (market === 'hits') {
    return calculateHits(game);
  }
  if (market === 'totalBases') {
    return calculateTotalBases(game);
  }
  if (market === 'homeRuns') {
    return calculateHomeRuns(game);
  }
  if (market === 'runs') {
    return calculateRuns(game);
  }
  if (market === 'rbi') {
    return calculateRBI(game);
  }
  if (market === 'hitsRunsRBI') {
    return calculateHitsRunsRBI(game);
  }
  if (market === 'hitsAllowed') return game.hitsAllowed ?? null;
  if (market === 'earnedRuns') return game.earnedRuns ?? null;
  if (market === 'outsRecorded') return calculateOutsRecorded(game.inningsPitched);
  return calculateStrikeouts(game);
}

function isPropHit(result: number | null, line: number, side: PropSide) {
  if (result == null) return null;
  if (Number.isInteger(line) && result === line) {
    return null;
  }

  return side === 'Over' ? result > line : result < line;
}

export function calculateHitRate({
  games,
  market,
  line,
  side,
  sampleSize,
}: {
  games: MLBGameLog[];
  market: PropMarket;
  line: number;
  side: PropSide;
  sampleSize: MLBRange;
}): HitRateResult {
  const selectedGames = selectGames(games, sampleSize);
  let hits = 0;
  let counted = 0;

  selectedGames.forEach((game) => {
    const result = getPropMetric(game, market);
    const outcome = isPropHit(result, line, side);
    if (outcome == null) return;
    counted += 1;
    if (outcome === true) {
      hits += 1;
    }
  });

  const percentage = counted > 0 ? Number(((hits / counted) * 100).toFixed(1)) : 0;
  return { hits, games: counted, percentage };
}
