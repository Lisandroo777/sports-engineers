'use client';

import Image from 'next/image';
import { useState } from 'react';
import { TeamLogo } from './TeamLogo';

const MLB_HEADSHOT_BASE =
  'https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_240,q_auto:best/v1/people';

/** Real, stable ESPN headshot CDN convention — keyed by the athlete's own provider ID, never guessed by name. */
function espnHeadshotUrl(sport: 'NFL' | 'NBA', playerId: number) {
  const path = sport === 'NFL' ? 'nfl' : 'nba';
  return `https://a.espncdn.com/i/headshots/${path}/players/full/${playerId}.png`;
}

export interface PlayerHeadshotProps {
  sport: string;
  playerId?: number | null;
  playerName?: string;
  /** Pre-resolved provider headshot URL, when the candidate already carries one (e.g. NFL/NBA ESPN payloads). */
  headshotUrl?: string | null;
  teamId?: number | null;
  teamName?: string;
  size?: number;
  className?: string;
  /** Large hero presentation: bigger radius, no circular crop, fades into the surface. */
  hero?: boolean;
}

/**
 * Sport-aware player image resolver. Resolution is ALWAYS by stable provider ID, never by name
 * guessing. Fallback order: real headshot -> team logo -> DeepSide initials. Never renders a
 * broken <img>; a failed load swaps to the next fallback via onError.
 */
export function PlayerHeadshot({ sport, playerId, playerName, headshotUrl, teamId, teamName, size = 96, className = '', hero = false }: PlayerHeadshotProps) {
  const [stage, setStage] = useState<'photo' | 'team' | 'initials'>('photo');

  const normalizedSport = sport?.toUpperCase();
  const resolvedUrl = headshotUrl
    ?? (normalizedSport === 'MLB' && playerId ? `${MLB_HEADSHOT_BASE}/${playerId}/headshot/67/current` : null)
    ?? ((normalizedSport === 'NFL' || normalizedSport === 'NBA') && playerId ? espnHeadshotUrl(normalizedSport, playerId) : null);

  const initials = playerName
    ? playerName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : '?';

  const shape = hero ? 'rounded-3xl' : 'rounded-full';

  if (stage === 'photo' && resolvedUrl) {
    return (
      <Image
        src={resolvedUrl}
        alt={playerName ?? 'Player'}
        width={size}
        height={size}
        unoptimized
        className={`shrink-0 bg-black/20 object-cover ${shape} ${className}`}
        onError={() => setStage(teamId ? 'team' : 'initials')}
      />
    );
  }

  if (stage === 'team' && teamId) {
    return (
      <div style={{ width: size, height: size }} className={`flex shrink-0 items-center justify-center bg-white/5 ${shape} ${className}`}>
        <TeamLogo teamId={teamId} teamName={teamName} size={Math.round(size * 0.6)} className="mx-auto" />
      </div>
    );
  }

  const fontSize = Math.max(11, Math.floor(size * 0.3));
  return (
    <div
      style={{ width: size, height: size, fontSize }}
      className={`flex shrink-0 items-center justify-center bg-emerald-400/10 font-bold text-emerald-300 ${shape} ${className}`}
    >
      {initials}
    </div>
  );
}
