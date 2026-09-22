import { notFound } from 'next/navigation';
import { getNFLPlayer } from '@/lib/nfl/players';
import { getPlayerGameLogs } from '@/lib/nfl/stats';
import { getNFLSchedule } from '@/lib/nfl/schedule';
import { isValidSlateDate } from '@/lib/dateModel';
import NFLResearchDetailClient from './NFLResearchDetailClient';
import type { NFLGame } from '@/lib/nfl/types';

interface NFLResearchDetailPageProps {
  params: Promise<{ playerId: string }>;
  searchParams: Promise<{ date?: string }>;
}

export default async function NFLResearchDetailPage({ params, searchParams }: NFLResearchDetailPageProps) {
  const { playerId } = await params;
  const { date: dateParam } = await searchParams;
  const slateDate = isValidSlateDate(dateParam) ? dateParam : undefined;
  const id = Number(playerId);
  if (!id) notFound();

  let player;
  try {
    player = await getNFLPlayer(id);
  } catch {
    notFound();
  }

  const [gameLog, schedule] = await Promise.all([
    getPlayerGameLogs(id).catch(() => []),
    getNFLSchedule(slateDate ? { date: slateDate } : undefined).catch(() => [] as NFLGame[]),
  ]);

  const currentGame = player.team
    ? schedule.find((game) => game.homeTeam.id === player.team!.id || game.awayTeam.id === player.team!.id) ?? null
    : null;

  return <NFLResearchDetailClient player={player} gameLog={gameLog} currentGame={currentGame} />;
}
