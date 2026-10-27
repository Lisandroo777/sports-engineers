'use client';

import { NBA_MARKET_CATEGORIES, NBA_RESEARCH_MARKETS, nbaMarketAvailability, type NBAResearchFilter } from '../lib/nba/researchMarkets';

export function NBAResearchMarketFilter({ value, onChange, disabled }: {
  value: NBAResearchFilter; onChange: (next: NBAResearchFilter) => void; disabled: boolean;
}) {
  const selected = new Set(value.marketIds ?? NBA_RESEARCH_MARKETS.map(entry => entry.id));
  return <fieldset disabled={disabled} className="min-w-0 space-y-3 text-left disabled:opacity-60">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
      <span className="text-xs text-slate-300">{value.marketIds == null ? 'All Markets' : `${selected.size} markets selected`}</span>
      <div className="flex gap-4 text-xs font-semibold text-cyan-300">
        <button type="button" onClick={() => onChange({ ...value, marketIds: null })}>Select All</button>
        <button type="button" onClick={() => onChange({ ...value, marketIds: [] })}>Clear All</button>
      </div>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <fieldset className="flex items-center gap-4 text-xs">
        <legend className="sr-only">Over and under selections</legend>
        {(['over', 'under'] as const).map(side => <label key={side} className="flex min-h-9 items-center gap-2 capitalize">
          <input type="checkbox" checked={value.sides.includes(side)} className="h-4 w-4 accent-cyan-400"
            onChange={event => onChange({ ...value, sides: event.target.checked ? [...value.sides, side] : value.sides.filter(entry => entry !== side) })} />{side}
        </label>)}
      </fieldset>
      <fieldset className="flex flex-wrap gap-1 text-xs" aria-label="Ranking mode">
        {([['BEST', 'Best'], ['MOST_LIKELY', 'Most Likely'], ['BEST_VALUE', 'Best Value']] as const).map(([ranking, label]) =>
          <label key={ranking} className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-2 ${value.ranking === ranking ? 'bg-cyan-400/15 text-cyan-200' : 'text-slate-400'}`}>
            <input type="radio" name="nba-ranking" checked={value.ranking === ranking} onChange={() => onChange({ ...value, ranking })} className="accent-cyan-400" />{label}
          </label>)}
      </fieldset>
    </div>
    <p className="text-[11px] leading-5 text-slate-400">Connected: pipeline wired, subject to live data and publication gates. Partial: cached quotes, historical evidence or model readiness required. Not connected: unsupported; not researched. Double-/Triple-Double use Yes/No, displayed as Over/Under 0.5.</p>
    <div className="grid min-w-0 gap-x-6 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
      {NBA_MARKET_CATEGORIES.map(category => {
        const entries = NBA_RESEARCH_MARKETS.filter(entry => entry.category === category);
        const count = entries.filter(entry => selected.has(entry.id)).length;
        return <fieldset key={category} className="min-w-0 border-t border-white/10 pt-2">
          <legend className="sr-only">{category}</legend>
          <label className="mb-1 flex min-h-9 items-center gap-2 text-xs font-semibold text-white">
            <input type="checkbox" className="h-4 w-4 shrink-0 accent-cyan-400" checked={count === entries.length}
              ref={node => { if (node) node.indeterminate = count > 0 && count < entries.length; }}
              onChange={event => {
                const next = new Set(selected);
                for (const entry of entries) { if (event.target.checked) next.add(entry.id); else next.delete(entry.id); }
                onChange({ ...value, marketIds: [...next] });
              }} />
            <span className="min-w-0 break-words">{category}</span><span className="ml-auto text-slate-500">{count}/{entries.length}</span>
          </label>
          {entries.map(entry => <label key={entry.id} title={nbaMarketAvailability(entry)} className="flex min-h-10 cursor-pointer items-center gap-2 py-1 text-xs text-slate-300">
            <input type="checkbox" checked={selected.has(entry.id)} className="h-4 w-4 shrink-0 accent-cyan-400"
              onChange={event => {
                const next = new Set(selected);
                if (event.target.checked) next.add(entry.id); else next.delete(entry.id);
                onChange({ ...value, marketIds: [...next] });
              }} />
            <span className="min-w-0 flex-1 break-words">{entry.label}</span>
            <span className={`shrink-0 text-[10px] ${entry.connection === 'Connected' ? 'text-emerald-300' : entry.connection === 'Partial' ? 'text-amber-200' : 'text-slate-500'}`}>{entry.connection}</span>
          </label>)}
        </fieldset>;
      })}
    </div>
    {selected.size === 0 && <p role="status" className="text-xs text-amber-200">No markets selected.</p>}
  </fieldset>;
}