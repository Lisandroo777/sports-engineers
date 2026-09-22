'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AddPickButton } from '../../components/AddPickButton';
import { AppSidebar } from '../../components/AppSidebar';
import { getResearchHref } from '../../lib/researchHref';
import type { MLBGame } from '../../lib/mlb/types';
import type { MarketConsensusOpportunity } from '../../lib/odds/opportunities';

export default function EvPage() {
  const [games, setGames] = useState<MLBGame[]>([]);
  const [selectedGameId, setSelectedGameId] = useState('');
  const [opportunities, setOpportunities] = useState<MarketConsensusOpportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [minEv, setMinEv] = useState(0);
  const [sort, setSort] = useState<'ev' | 'price' | 'updated'>('ev');

  useEffect(() => {
    fetch('/api/mlb/schedule').then((response) => response.ok ? response.json() : null).then((payload) => {
      const nextGames = payload?.data ?? [];
      setGames(nextGames);
      setSelectedGameId(nextGames[0]?.id ?? '');
    }).finally(() => setLoading(false));
  }, []);

  const selectedGame = games.find((game) => game.id === selectedGameId);

  useEffect(() => {
    if (!selectedGame) return;
    setOpportunities([]);
    fetch(`/api/odds/mlb/ev?home=${encodeURIComponent(selectedGame.homeTeam.name)}&away=${encodeURIComponent(selectedGame.awayTeam.name)}`)
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => setOpportunities(payload?.data ?? []));
  }, [selectedGame]);

  const rows = useMemo(() => opportunities.filter((row) => row.evPercent >= minEv).sort((left, right) => {
    if (sort === 'price') return right.odds - left.odds;
    if (sort === 'updated') return right.lastUpdate.localeCompare(left.lastUpdate);
    return right.evPercent - left.evPercent;
  }), [opportunities, minEv, sort]);

  return <div className="flex min-h-screen bg-[#060d18] text-white">
    <AppSidebar currentPath="/ev" />
    <main className="min-w-0 flex-1 p-5">
      <div className="mx-auto max-w-7xl space-y-5">
        <div><h1 className="text-2xl font-bold text-white">+EV</h1><p className="mt-1 text-sm text-slate-400">Market Consensus EV. Fair probability is derived from available sportsbook prices after vig removal.</p></div>
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/6 bg-white/3 p-3">
          <select value={selectedGameId} onChange={(event) => setSelectedGameId(event.target.value)} className="rounded-lg border border-white/10 bg-[#0b1522] px-3 py-2 text-sm text-white">
            {games.map((game) => <option key={game.id} value={game.id}>{game.awayTeam.name} @ {game.homeTeam.name}</option>)}
          </select>
          <select value={minEv} onChange={(event) => setMinEv(Number(event.target.value))} className="rounded-lg border border-white/10 bg-[#0b1522] px-3 py-2 text-sm text-white"><option value={0}>Any +EV</option><option value={2}>2%+</option><option value={5}>5%+</option></select>
          <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="rounded-lg border border-white/10 bg-[#0b1522] px-3 py-2 text-sm text-white"><option value="ev">Sort: EV</option><option value="price">Sort: Price</option><option value="updated">Sort: Updated</option></select>
          <span className="ml-auto text-xs text-slate-500">{selectedGame?.status ?? ''}</span>
        </div>
        {loading ? <p className="text-sm text-slate-400">Loading games…</p> : null}
        <div className="overflow-x-auto rounded-2xl border border-white/6 bg-white/3"><table className="w-full min-w-[900px] text-left"><thead className="border-b border-white/5 text-[10px] uppercase tracking-wider text-slate-500"><tr><th className="px-4 py-3">Player</th><th>Prop</th><th>Line</th><th>Sportsbook</th><th>Odds</th><th>Fair</th><th>EV</th><th>Books</th><th>Updated</th><th className="px-4 py-3">Actions</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-b border-white/5 last:border-0"><td className="px-4 py-3 text-sm font-semibold">{row.player}</td><td className="text-sm">{row.side === 'over' ? 'Over' : 'Under'} {row.marketLabel}</td><td className="text-sm">{row.line}</td><td className="text-sm text-slate-300">{row.sportsbookName}</td><td className="text-sm font-semibold">{row.odds > 0 ? `+${row.odds}` : row.odds}</td><td className="text-sm">{(row.fairProbability * 100).toFixed(1)}% {row.fairOdds ? `(${row.fairOdds > 0 ? '+' : ''}${row.fairOdds})` : ''}</td><td className="text-sm font-bold text-emerald-400">+{row.evPercent.toFixed(1)}%</td><td className="text-sm">{row.availableBooks}</td><td className="text-xs text-slate-500">{row.lastUpdate ? new Date(row.lastUpdate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '—'}</td><td className="flex gap-2 px-4 py-3">{row.playerId ? <Link href={getResearchHref({ playerId: row.playerId })} className="text-xs text-emerald-400">Research</Link> : <span className="text-xs text-slate-500">Player ID unavailable</span>}<AddPickButton id={row.id} playerId={row.playerId ?? undefined} playerName={row.player} teamName="Data unavailable" opponentName="Data unavailable" gameId={row.eventId} gameTime={selectedGame?.gameTime ?? ''} propType={row.marketLabel} side={row.side} line={row.line} odds={row.odds} /></td></tr>)}{!loading && rows.length === 0 ? <tr><td colSpan={10} className="px-4 py-8 text-center text-sm text-slate-500">No Market Consensus EV opportunities. At least two sportsbooks with both sides are required.</td></tr> : null}</tbody></table></div>
      </div>
    </main>
  </div>;
}
