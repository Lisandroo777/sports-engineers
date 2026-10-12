'use client';

import React from 'react';

interface DeepSideLogoProps {
  className?: string;
  size?: 'sm' | 'md' | 'lg' | 'hero';
  showTagline?: boolean;
  taglineClassName?: string;
  priority?: boolean;
  alt?: string;
}

export function DeepSideLogo({
  className = '',
  size = 'md',
  showTagline = true,
  taglineClassName = '',
}: DeepSideLogoProps) {
  const textSizes = {
    sm: 'text-base sm:text-lg',
    md: 'text-xl sm:text-2xl',
    lg: 'text-2xl sm:text-3xl',
    hero: 'text-4xl sm:text-6xl md:text-7xl',
  };

  const taglineSizes = {
    sm: 'text-[7.5px] sm:text-[8px] tracking-[0.16em] mt-0.5',
    md: 'text-[8.5px] sm:text-[9px] tracking-[0.2em] mt-1',
    lg: 'text-[9.5px] sm:text-[10px] tracking-[0.22em] mt-1',
    hero: 'text-xs sm:text-sm md:text-base tracking-[0.26em] mt-2 sm:mt-3',
  };

  return (
    <div className={`inline-flex flex-col items-center select-none text-center ${className}`}>
      <div className={`flex items-baseline font-black italic tracking-tighter ${textSizes[size]}`}>
        <span className="bg-gradient-to-b from-white via-slate-100 to-slate-400 bg-clip-text text-transparent drop-shadow-[0_2px_12px_rgba(255,255,255,0.3)]">
          DEEPSIDE
        </span>
        <span className="ml-2 bg-gradient-to-r from-[#38bdf8] via-[#0ea5e9] to-[#00b4d8] bg-clip-text text-transparent drop-shadow-[0_0_24px_rgba(0,180,216,0.8)]">
          AI
        </span>
      </div>
      {showTagline && (
        <span
          className={`font-bold uppercase text-[#38bdf8] drop-shadow-[0_0_12px_rgba(56,189,248,0.55)] ${taglineSizes[size]} ${taglineClassName}`}
        >
          GO DEEPER INTO YOUR PICKS.
        </span>
      )}
    </div>
  );
}
