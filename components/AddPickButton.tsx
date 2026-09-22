'use client';

import { usePicks } from './PicksProvider';

interface AddPickButtonProps {
  id: string;
  playerId?: number;
  playerName: string;
  teamId?: number;
  teamName: string;
  opponentName: string;
  gameId?: string;
  gameTime: string;
  propType: string;
  side: 'over' | 'under';
  line: number;
  odds: number;
}

export function AddPickButton(props: AddPickButtonProps) {
  const { addPick, hasPick, openPicks } = usePicks();
  const saved = hasPick(props.id);

  function handleClick() {
    if (saved) {
      openPicks();
      return;
    }
    addPick({
      ...props,
      playerId: String(props.playerId ?? props.playerName),
      teamId: String(props.teamId ?? props.teamName),
      gameId: props.gameId ?? `${props.teamName}-${props.opponentName}-${props.gameTime}`,
      savedOdds: props.odds,
    });
    openPicks();
  }

  return <button type="button" onClick={handleClick} className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${saved ? 'border-[var(--se-border-strong)] bg-[var(--se-green-soft)] text-[var(--se-green)]' : 'border-white/10 text-slate-400 hover:border-[var(--se-border-strong)] hover:text-white'}`}>{saved ? 'In My Picks' : '+ Add Pick'}</button>;
}
