import React from 'react';
import type { NFLSportsbookPrice } from '../lib/nfl/underlyingPlays';

export function NFLSportsbookPrices({ prices, primary }: { prices: NFLSportsbookPrice[]; primary: string | null }) {
  if (prices.length < 2) return null;
  return <details className="mt-3 border-t border-white/10 pt-2 text-xs text-slate-300">
    <summary className="cursor-pointer font-semibold">Sportsbook Prices ({prices.length})</summary>
    <ul className="mt-2 space-y-1">{prices.map((price) => <li key={price.candidateId} className="flex flex-wrap justify-between gap-2">
      <span>{price.sportsbook ?? 'Unknown sportsbook'}{price.sportsbook === primary ? ' · Selected best price' : ''}</span>
      <span>{price.odds > 0 ? '+' : ''}{price.odds}{!price.eliteQualified ? ' · Not Elite at this price' : ''}</span>
    </li>)}</ul>
  </details>;
}