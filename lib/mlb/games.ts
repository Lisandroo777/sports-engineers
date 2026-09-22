import { getMLBSchedule } from './schedule';
import { getMLBPlayer, getPlayerImageUrl } from './players';
import { getPlayerGameLogs } from './stats';
import { getMLBVenue } from './venue';
import { getProbablePitchers as getPitcherData } from './pitchers';
import type { MLBGame, MLBProbablePitcher, MLBVenue, MLBPlayer } from './types';

export async function getMLBGame(gameId: string): Promise<MLBGame | null> {
  const schedule = await getMLBSchedule();
  return schedule.find((game) => game.id === gameId) ?? null;
}

export async function getGameProbablePitchers(gameId: string): Promise<{ away: MLBProbablePitcher | null; home: MLBProbablePitcher | null }> {
  return getPitcherData(gameId);
}

export async function getMLBVenueById(venueId: string | null): Promise<MLBVenue | null> {
  if (!venueId) {
    return null;
  }

  return getMLBVenue(venueId);
}

export async function getMLBPlayerDetails(playerId: string | number): Promise<MLBPlayer> {
  return getMLBPlayer(playerId);
}

export function getMLBPlayerImage(playerId: string | number) {
  return getPlayerImageUrl(playerId);
}

export async function getMLBPlayerRecentGames(playerId: string | number, season: number = 2026) {
  return getPlayerGameLogs(playerId, season);
}
