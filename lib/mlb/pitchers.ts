import { MLBDataUnavailableError, mlbFetch } from './client';
import type { MLBProbablePitcher } from './types';

export async function getProbablePitchers(gameId: string) {
  try {
    const payload = await mlbFetch<{ gameData?: { game?: { homeProbablePitcher?: Record<string, unknown>; awayProbablePitcher?: Record<string, unknown> } } }>(`/game/${gameId}/boxscore`, {
      revalidate: 300,
    });
    const gameData = payload.gameData?.game ?? {};
    return {
      away: gameData.awayProbablePitcher ? {
        id: Number((gameData.awayProbablePitcher as Record<string, unknown>).id ?? 0),
        name: String((gameData.awayProbablePitcher as Record<string, unknown>).name ?? 'TBD'),
        throwingHand: String((gameData.awayProbablePitcher as Record<string, unknown>).throwingHand ?? 'R'),
      } : null,
      home: gameData.homeProbablePitcher ? {
        id: Number((gameData.homeProbablePitcher as Record<string, unknown>).id ?? 0),
        name: String((gameData.homeProbablePitcher as Record<string, unknown>).name ?? 'TBD'),
        throwingHand: String((gameData.homeProbablePitcher as Record<string, unknown>).throwingHand ?? 'L'),
      } : null,
    };
  } catch (error) {
    console.error('[mlb] Unable to load probable pitchers.', error);
    throw error instanceof MLBDataUnavailableError ? error : new MLBDataUnavailableError();
  }
}
