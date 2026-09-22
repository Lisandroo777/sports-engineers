import { espnNBASiteFetch } from './client';
import type { NBAGame, NBATeam } from './types';

interface RawTeam { id: string; displayName: string; name?: string; abbreviation: string; logo?: string; }
interface RawCompetitor { homeAway: 'home' | 'away'; team: RawTeam; score?: string; }
interface RawEvent { id: string; date: string; competitions: Array<{ competitors: RawCompetitor[]; status?: { type?: { completed?: boolean } } }>; }

function normalizeTeam(team: RawTeam): NBATeam {
  return { id: Number(team.id), name: team.name ?? team.displayName, displayName: team.displayName, abbreviation: team.abbreviation, logoUrl: team.logo ?? null };
}

export async function getNBASchedule(date?: string): Promise<NBAGame[]> {
  const data = await espnNBASiteFetch<{ events?: RawEvent[] }>('scoreboard', date ? { dates: date.replace(/-/g, '') } : {}, 300);
  return (data.events ?? []).map((event) => {
    const competition = event.competitions?.[0];
    const home = competition?.competitors?.find((team) => team.homeAway === 'home');
    const away = competition?.competitors?.find((team) => team.homeAway === 'away');
    if (!home || !away) throw new Error('Malformed NBA scoreboard event');
    return {
      id: event.id,
      gameTime: event.date,
      homeTeam: normalizeTeam(home.team),
      awayTeam: normalizeTeam(away.team),
      homeScore: home.score == null ? null : Number(home.score),
      awayScore: away.score == null ? null : Number(away.score),
      completed: Boolean(competition?.status?.type?.completed),
    };
  });
}
