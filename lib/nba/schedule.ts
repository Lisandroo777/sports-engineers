import { espnNBASiteFetch } from './client';
import type { NBAGame, NBATeam } from './types';

interface RawTeam { id: string; displayName: string; name?: string; abbreviation: string; logo?: string; }
interface RawCompetitor { homeAway: 'home' | 'away'; team: RawTeam; score?: string; }
interface RawEvent {
  id: string;
  date: string;
  season?: { year?: number; type?: number; name?: string };
  week?: { number?: number; text?: string };
  competitions: Array<{ competitors: RawCompetitor[]; status?: { type?: { completed?: boolean } } }>;
}

function seasonPhase(event: RawEvent): NonNullable<NBAGame['phase']> {
  const metadata = `${event.season?.name ?? ''} ${event.week?.text ?? ''}`;
  if (event.season?.type === 1 || /preseason/i.test(metadata)) return 'PRESEASON';
  if (/play.?in/i.test(metadata)) return 'PLAY_IN';
  if (event.season?.type === 3 || /postseason|playoffs/i.test(metadata)) return 'POSTSEASON';
  if (event.season?.type === 2 || /regular/i.test(metadata)) return 'REGULAR';
  return 'UNKNOWN';
}

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
      seasonId: event.season?.year == null ? null : String(event.season.year),
      season: event.season?.year ?? null,
      phase: seasonPhase(event),
      round: event.week?.text ?? null,
      homeTeam: normalizeTeam(home.team),
      awayTeam: normalizeTeam(away.team),
      homeScore: home.score == null ? null : Number(home.score),
      awayScore: away.score == null ? null : Number(away.score),
      completed: Boolean(competition?.status?.type?.completed),
    };
  });
}
