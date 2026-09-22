import { NextResponse } from 'next/server';
import { getOddsEventsForSport } from '@/lib/odds/client';
import { getNFLSchedule } from '@/lib/nfl/schedule';
import { resolveSlateDate } from '@/lib/dateModel';

const NFL_ODDS_SPORT_KEY = 'americanfootball_nfl';

function normalizeTeamName(name: string) {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Free-endpoint-only verification route: confirms the `americanfootball_nfl` events list is
 * reachable and cross-matches it against our real ESPN schedule. Never requests per-event markets
 * (the paid part) — this is purely a read of `/sports/{sport}/events`, which costs 0 credits.
 */
export async function GET(request: Request) {
  const slateDate = resolveSlateDate(new URL(request.url).searchParams.get('date'));
  try {
    const [oddsEvents, scheduleGames] = await Promise.all([
      getOddsEventsForSport(NFL_ODDS_SPORT_KEY),
      getNFLSchedule({ date: slateDate }).catch(() => []),
    ]);

    const matches = scheduleGames.map((game) => {
      const home = normalizeTeamName(game.homeTeam.displayName);
      const away = normalizeTeamName(game.awayTeam.displayName);
      const event = oddsEvents.find((e) => normalizeTeamName(e.homeTeam) === home && normalizeTeamName(e.awayTeam) === away);
      return {
        scheduleGame: `${game.awayTeam.displayName} @ ${game.homeTeam.displayName}`,
        matchedEventId: event?.id ?? null,
        matchedCommenceTime: event?.commenceTime ?? null,
      };
    });

    return NextResponse.json({
      data: {
        slateDate,
        oddsEventCount: oddsEvents.length,
        oddsEvents: oddsEvents.map((e) => ({ id: e.id, homeTeam: e.homeTeam, awayTeam: e.awayTeam, commenceTime: e.commenceTime })),
        scheduleGameCount: scheduleGames.length,
        matches,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Data unavailable.' }, { status: 502 });
  }
}
