'use client';

import Image from 'next/image';
import { useState } from 'react';

// MLB headshot CDN — generic silhouette fallback is baked into the URL
const HEADSHOT_BASE =
  'https://img.mlbstatic.com/mlb-photos/image/upload/d_people:generic:headshot:67:current.png/w_120,q_auto:best/v1/people';

interface PlayerAvatarProps {
  playerId?: number | null;
  playerName?: string;
  initials?: string;
  size?: number;
  className?: string;
}

export function PlayerAvatar({ playerId, playerName, initials, size = 36, className = '' }: PlayerAvatarProps) {
  const [failed, setFailed] = useState(false);

  const fallbackText =
    initials ??
    (playerName
      ? playerName
          .split(' ')
          .map((w) => w[0])
          .join('')
          .slice(0, 2)
          .toUpperCase()
      : '?');

  const fontSize = Math.max(9, Math.floor(size * 0.33));

  if (!playerId || failed) {
    return (
      <div
        style={{ width: size, height: size, fontSize }}
        className={`flex shrink-0 items-center justify-center rounded-full bg-slate-700/80 font-bold text-slate-300 ${className}`}
      >
        {fallbackText}
      </div>
    );
  }

  return (
    <Image
      src={`${HEADSHOT_BASE}/${playerId}/headshot/67/current`}
      alt={playerName ?? 'Player'}
      width={size}
      height={size}
      className={`shrink-0 rounded-full object-cover ${className}`}
      onError={() => setFailed(true)}
      unoptimized
    />
  );
}
