'use client';

import Image from 'next/image';
import { useState } from 'react';

// MLB Stats CDN — transparent PNG, no authentication needed
const LOGO_BASE = 'https://midfield.mlbstatic.com/v1/team';

interface TeamLogoProps {
  teamId?: number | null;
  abbreviation?: string;
  teamName?: string;
  size?: number;
  className?: string;
}

export function TeamLogo({ teamId, abbreviation, teamName, size = 32, className = '' }: TeamLogoProps) {
  const [failed, setFailed] = useState(false);

  const fallbackText = abbreviation ?? teamName?.slice(0, 3).toUpperCase() ?? '?';
  const fontSize = Math.max(8, Math.floor(size * 0.3));

  if (!teamId || failed) {
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
      src={`${LOGO_BASE}/${teamId}/spots/124`}
      alt={teamName ?? abbreviation ?? 'Team'}
      width={size}
      height={size}
      className={`shrink-0 object-contain ${className}`}
      onError={() => setFailed(true)}
      unoptimized
    />
  );
}
