'use client';

import { useState } from 'react';
import { NBAPresentationCards } from './NBAPresentationCards';
import type { NBAClientPresentation } from './NBAPresentationCards';
import type { NBAResearchFilter } from '../lib/nba/researchMarkets';
import { DEFAULT_NBA_RESEARCH_FILTER } from '../lib/nba/researchMarkets';
import { NBA_DEMO_MARKET_IDS } from '../lib/nba/prediction/historicalDemo';

export function NBAHistoricalDemo({ filter }: { filter: NBAResearchFilter }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [demo, setDemo] = useState<{ label: string; notice: string; presentation: NBAClientPresentation } | null>(null);
  const selected = filter.marketIds == null ? NBA_DEMO_MARKET_IDS.length : NBA_DEMO_MARKET_IDS.filter(id => filter.marketIds!.includes(id)).length;
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="min-h-10 rounded-md border border-amber-300/30 bg-amber-400/5 px-3 text-xs font-semibold text-amber-100 hover:bg-amber-400/10">Show NBA test fixtures</button>;
  async function loadDemo() {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      for (const id of filter.marketIds ?? NBA_DEMO_MARKET_IDS) params.append('market', id);
      for (const side of filter.marketIds == null ? DEFAULT_NBA_RESEARCH_FILTER.sides : filter.sides) params.append('side', side);
      const response = await fetch(`/api/ai/demo/nba?${params}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Synthetic preview fixture unavailable.');
      setDemo(await response.json());
    } finally { setLoading(false); }
  }
  return <section aria-label="NBA synthetic research test demo" className="min-w-0 space-y-3 border-y border-amber-300/25 bg-amber-400/[0.03] p-3 sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 className="text-sm font-bold text-amber-100">TEST DATA · SYNTHETIC NBA FIXTURES</h2>
        <p className="mt-1 max-w-3xl break-words text-xs leading-5 text-amber-100/80">Mock player, team, line and outcome values only. Not a saved sportsbook receipt, historical event, current quote, recommendation, or wager. No API, Redis, AI, storage or odds acquisition is called.</p>
        <p className="mt-1 text-[11px] text-slate-400">Filter selection and ranking preference are reflected; fixture values are not ranked or modeled. {selected} verified-market identities selected.</p>
      </div>
      <button type="button" onClick={() => setOpen(false)} className="min-h-9 rounded-md border border-white/15 px-3 text-xs text-slate-300 hover:bg-white/10">Hide demo</button>
    </div>
    {!demo && <button type="button" disabled={loading} onClick={() => { void loadDemo().catch(() => setDemo({
      label: 'TEST DATA · SYNTHETIC NBA FIXTURES', notice: 'Synthetic fixture request failed; no live fallback was attempted.',
      presentation: { schemaVersion: 'deepside-nba-pick-presentation/1', outcome: 'NO_QUALIFIED_PICKS', requestedSort: filter.ranking, sortStatus: 'SOURCE_ORDER', picks: [], recommendedCandidateIds: [] },
    })); }} className="min-h-10 rounded-md border border-amber-300/30 px-3 text-xs text-amber-100 disabled:opacity-50">{loading ? 'Loading test fixtures…' : 'Load synthetic test fixtures'}</button>}
    {demo && <><p role="status" className="rounded-md border border-amber-300/30 p-3 text-xs text-amber-100"><strong className="block">{demo.label}</strong>{demo.notice}</p>
      {demo.presentation.picks.length ? <NBAPresentationCards presentation={demo.presentation} /> : <p className="text-xs text-slate-300">No selected fixture markets.</p>}</>}
  </section>;
}