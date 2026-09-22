'use client';

import Image from 'next/image';
import { useState } from 'react';

interface NFLPlayerAvatarProps {
  headshotUrl?: string | null;
  playerName?: string;
  size?: number;
  className?: string;
}

export function NFLPlayerAvatar({ headshotUrl, playerName, size = 36, className = '' }: NFLPlayerAvatarProps) {
  const [failed, setFailed] = useState(false);
  const fallbackText = playerName
    ? playerName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : '?';
  const fontSize = Math.max(9, Math.floor(size * 0.33));

  if (!headshotUrl || failed) {
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
      src={headshotUrl}
      alt={playerName ?? 'Player'}
      width={size}
      height={size}
      unoptimized
      className={`shrink-0 rounded-full bg-slate-800 object-cover ${className}`}
      onError={() => setFailed(true)}
    />
  );
}
