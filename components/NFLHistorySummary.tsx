import React from 'react';
import type { NFLMarketHistory } from '../lib/nfl/history';

export function NFLHistorySummary({ history }: { history: NFLMarketHistory }) {
  const season = history.sourceSeason;
  const rows = [
    ['Last 5', history.windows.l5], ['Last 10', history.windows.l10],
    [`Current season${season ? ` ${season}` : ''}`, history.windows.currentSeason],
    ['Rolling sample', history.windows.rolling],
    [`Previous season${season ? ` ${season - 1}` : ''} (recorded)`, history.windows.previousSeason],
  ] as const;
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-bold uppercase text-emerald-300">History Sample</h3>
        <p className="text-xs text-slate-400">{history.sample.currentSeasonGames} current-season observations · {history.sample.previousSeasonGames} previous-season observations included</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] text-left text-xs text-slate-300">
          <thead className="border-b border-white/10 text-slate-500"><tr>{['Window', 'Observations', 'Hits', 'Misses', 'Pushes', 'Win Rate'].map((label) => <th key={label} className="px-2 py-2 font-medium">{label}</th>)}</tr></thead>
          <tbody>{rows.map(([label, window]) => <tr key={label} className="border-b border-white/5"><td className="px-2 py-2">{label}</td><td className="px-2 py-2">{window.games} / {window.gamesConsidered}</td><td className="px-2 py-2">{window.hits}</td><td className="px-2 py-2">{window.misses}</td><td className="px-2 py-2">{window.pushes}</td><td className="px-2 py-2">{window.hitRate == null ? 'Unavailable' : `${window.hitRate}%`}</td></tr>)}</tbody>
        </table>
      </div>
      {history.sample.supplemented && <p className="text-xs text-slate-400">Cross-season confidence: {history.sample.confidence.toLowerCase()}</p>}
    </section>
  );
}