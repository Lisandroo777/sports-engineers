import type { MLBGame, MLBProbablePitcher, MLBTeamRecord } from '../../lib/mlb/types';
import type { BullpenStats, MatchupData, Pitcher, TeamForm, TeamSplit, WeatherInfo } from './mockData';
import type { NormalizedProp } from '../../lib/odds/types';

const UNAVAILABLE = '—';

export function formatRecord(record: MLBTeamRecord | null | undefined): string {
  if (!record) return UNAVAILABLE;
  return `${record.wins}-${record.losses}`;
}

export function formatGameTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return UNAVAILABLE;
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** Safely splits a "W-L" style record string; falls back cleanly for non-numeric records. */
export function splitRecord(record: string): [string, string] {
  const match = record.match(/^(\d+)-(\d+)$/);
  return match ? [match[1], match[2]] : [UNAVAILABLE, UNAVAILABLE];
}

function buildPitcher(name: string | undefined, hand: string | null | undefined, stats: MLBProbablePitcher | null): Pitcher {
  return {
    id: name ?? 'unannounced',
    name: name ?? 'Starter not announced',
    hand: hand ?? UNAVAILABLE,
    record: UNAVAILABLE,
    era: stats?.era != null ? stats.era.toFixed(2) : UNAVAILABLE,
    whip: stats?.whip != null ? stats.whip.toFixed(2) : UNAVAILABLE,
    fip: UNAVAILABLE,
    xfip: UNAVAILABLE,
    kPercent: stats?.kPct != null ? `${stats.kPct}%` : UNAVAILABLE,
    bbPercent: stats?.bbPct != null ? `${stats.bbPct}%` : UNAVAILABLE,
    kbb: UNAVAILABLE,
    hrPer9: UNAVAILABLE,
    baa: UNAVAILABLE,
    hardHit: UNAVAILABLE,
    gb: UNAVAILABLE,
    recent5Era: UNAVAILABLE,
    photo: '',
  };
}

function unavailableSplit(team: string): TeamSplit {
  return { team, vs: UNAVAILABLE, avg: UNAVAILABLE, obp: UNAVAILABLE, slg: UNAVAILABLE, ops: UNAVAILABLE, woba: UNAVAILABLE, wrcPlus: UNAVAILABLE, kPercent: UNAVAILABLE, bbPercent: UNAVAILABLE, iso: UNAVAILABLE, hrRate: UNAVAILABLE };
}

const unavailableForm: TeamForm = { last5: UNAVAILABLE, last10: UNAVAILABLE, streak: UNAVAILABLE, runsPerGame: UNAVAILABLE, runsAllowed: UNAVAILABLE, homeRecord: UNAVAILABLE, awayRecord: UNAVAILABLE };

const unavailableBullpen: BullpenStats = { era: UNAVAILABLE, fip: UNAVAILABLE, whip: UNAVAILABLE, kPercent: UNAVAILABLE, bbPercent: UNAVAILABLE, hrPer9: UNAVAILABLE, savePercent: UNAVAILABLE, last3Days: UNAVAILABLE, last7Days: UNAVAILABLE, fatigue: 'Moderate' };

/** Weather is a sentinel: 'unavailable' marks fields the UI must render as an explicit unavailable state, never as numbers. */
export const unavailableWeather: WeatherInfo = {
  stadium: UNAVAILABLE, city: UNAVAILABLE, temperature: UNAVAILABLE, condition: '', windSpeed: UNAVAILABLE, windDirection: '',
  humidity: UNAVAILABLE, rainChance: UNAVAILABLE, parkFactor: 'unavailable', hrFactor: 'unavailable', runFactor: 'unavailable',
};

export function buildLiveMatchupData(
  game: MLBGame,
  awayPitcherStats: MLBProbablePitcher | null,
  homePitcherStats: MLBProbablePitcher | null,
  awayTeamRecord: MLBTeamRecord | null,
  homeTeamRecord: MLBTeamRecord | null,
  realProps: NormalizedProp[] = [],
): MatchupData {
  return {
    id: game.id,
    game: {
      id: game.id,
      awayTeam: game.awayTeam.name,
      homeTeam: game.homeTeam.name,
      awayTeamId: game.awayTeam.id,
      homeTeamId: game.homeTeam.id,
      awayRecord: formatRecord(awayTeamRecord ?? game.awayTeam.record),
      homeRecord: formatRecord(homeTeamRecord ?? game.homeTeam.record),
      time: formatGameTime(game.gameTime),
      stadium: game.venue?.stadiumName ?? UNAVAILABLE,
      weather: UNAVAILABLE,
      moneyline: UNAVAILABLE,
      runLine: UNAVAILABLE,
      total: UNAVAILABLE,
      awayLogo: game.awayTeam.abbreviation,
      homeLogo: game.homeTeam.abbreviation,
    },
    awayPitcher: buildPitcher(game.awayProbableStarter?.name, game.awayProbableStarter?.throwingHand, awayPitcherStats),
    homePitcher: buildPitcher(game.homeProbableStarter?.name, game.homeProbableStarter?.throwingHand, homePitcherStats),
    awayLineup: [],
    homeLineup: [],
    awaySplit: unavailableSplit(game.awayTeam.name),
    homeSplit: unavailableSplit(game.homeTeam.name),
    awayBullpen: unavailableBullpen,
    homeBullpen: unavailableBullpen,
    awayForm: unavailableForm,
    homeForm: unavailableForm,
    awayRecentGames: [],
    homeRecentGames: [],
    headToHead: [],
    weather: unavailableWeather,
    edges: [],
    insights: [],
    relevantProps: [],
    playersToWatch: [],
    propAngles: [],
    bvpAway: [],
    bvpHome: [],
    realProps,
  };
}
