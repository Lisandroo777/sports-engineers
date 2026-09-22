'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { getMLBPlayerDetails, getMLBPlayerRecentGames, getMLBPlayerImage } from '@/lib/mlb/games';
import { getMLBSchedule } from '@/lib/mlb/schedule';
import { searchMLBPlayers } from '@/lib/mlb/players';
import type { MLBGame, MLBPlayer, MLBGameLog } from '@/lib/mlb/types';

export default function DevMLBPage() {
  const [games, setGames] = useState<MLBGame[]>([]);
  const [search, setSearch] = useState('Ohtani');
  const [players, setPlayers] = useState<MLBPlayer[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<MLBPlayer | null>(null);
  const [logs, setLogs] = useState<MLBGameLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      setLoading(true);
      setError(null);
      try {
        const [schedule, playerResults] = await Promise.all([getMLBSchedule(), searchMLBPlayers(search)]);
        setGames(schedule);
        setPlayers(playerResults);
        if (playerResults[0]) {
          const player = await getMLBPlayerDetails(playerResults[0].id);
          setSelectedPlayer(player);
          const recentGames = await getMLBPlayerRecentGames(player.id, 2026);
          setLogs(recentGames.slice(0, 10));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load MLB data.');
      } finally {
        setLoading(false);
      }
    }

    init();
  }, [search]);

  const recentGames = useMemo(() => logs.slice(0, 10), [logs]);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(34,197,94,0.14),_transparent_30%),linear-gradient(135deg,_#020617_0%,_#07111f_50%,_#030712_100%)] text-slate-50">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 lg:px-6 lg:py-6">
        <header className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[11px] uppercase tracking-[0.28em] text-emerald-300">Development</p>
              <h1 className="text-xl font-semibold text-white">MLB data integration test</h1>
            </div>
            <Link href="/dashboard" className="rounded-full border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:border-emerald-500 hover:text-emerald-300">Back to dashboard</Link>
          </div>
        </header>

        {loading ? <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 text-sm text-slate-300">Loading MLB data…</div> : null}
        {error ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-4 text-sm text-rose-300">{error}</div> : null}

        <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-[11px] uppercase tracking-[0.28em] text-emerald-300">Today&apos;s games</p>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {games.map((game) => (
              <div key={game.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                <p className="text-sm text-slate-400">{game.gameTime}</p>
                <p className="mt-1 text-sm font-semibold text-white">{game.awayTeam.name} vs {game.homeTeam.name}</p>
                <p className="mt-1 text-xs text-slate-400">Venue: {game.venue?.stadiumName ?? 'TBD'}</p>
                <p className="mt-1 text-xs text-slate-400">Probable: {game.awayProbableStarter?.name ?? 'TBD'} • {game.homeProbableStarter?.name ?? 'TBD'}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-[11px] uppercase tracking-[0.28em] text-emerald-300">Player search</p>
          <input value={search} onChange={(event) => setSearch(event.target.value)} className="mt-3 w-full rounded-2xl border border-slate-800 bg-slate-900/70 px-3 py-2 text-sm text-white outline-none" placeholder="Search MLB player" />
          <div className="mt-3 flex flex-wrap gap-2">
            {players.map((player) => (
              <button key={player.id} onClick={async () => {
                const detail = await getMLBPlayerDetails(player.id);
                setSelectedPlayer(detail);
                const recent = await getMLBPlayerRecentGames(detail.id, 2026);
                setLogs(recent.slice(0, 10));
              }} className="rounded-full border border-slate-700 px-3 py-2 text-sm text-slate-300 transition hover:border-emerald-500 hover:text-emerald-300">
                {player.name}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-[11px] uppercase tracking-[0.28em] text-emerald-300">Player profile</p>
          {selectedPlayer ? (
            <div className="mt-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-sm font-semibold text-emerald-300">{selectedPlayer.name.split(' ').map((piece) => piece[0]).slice(0, 2).join('')}</div>
                <div>
                  <p className="text-lg font-semibold text-white">{selectedPlayer.name}</p>
                  <p className="text-sm text-slate-400">{selectedPlayer.currentTeam?.name ?? 'Unknown Team'} • {selectedPlayer.position ?? 'Unknown'}</p>
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-2">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Bats</p>
                  <p className="mt-1 text-sm text-slate-200">{selectedPlayer.batSide ?? '—'}</p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-2">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Throws</p>
                  <p className="mt-1 text-sm text-slate-200">{selectedPlayer.throwSide ?? '—'}</p>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-2">
                  <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Image</p>
                  <p className="mt-1 text-sm text-slate-200">{getMLBPlayerImage(selectedPlayer.id) ?? 'placeholder'}</p>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <section className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
          <p className="text-[11px] uppercase tracking-[0.28em] text-emerald-300">Recent 10 games</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm text-slate-300">
              <thead className="text-[10px] uppercase tracking-[0.24em] text-slate-500">
                <tr>
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Opponent</th>
                  <th className="pb-2">PA</th>
                  <th className="pb-2">H</th>
                  <th className="pb-2">HR</th>
                  <th className="pb-2">RBI</th>
                  <th className="pb-2">TB</th>
                  <th className="pb-2">BB</th>
                  <th className="pb-2">K</th>
                </tr>
              </thead>
              <tbody>
                {recentGames.map((game) => (
                  <tr key={game.date} className="border-t border-slate-800 text-sm text-slate-300">
                    <td className="py-2">{game.date}</td>
                    <td className="py-2">{game.opponent}</td>
                    <td className="py-2">{game.plateAppearances ?? '—'}</td>
                    <td className="py-2">{game.hits ?? '—'}</td>
                    <td className="py-2">{game.homeRuns ?? '—'}</td>
                    <td className="py-2">{game.rbi ?? '—'}</td>
                    <td className="py-2">{game.totalBases ?? '—'}</td>
                    <td className="py-2">{game.walks ?? '—'}</td>
                    <td className="py-2">{game.strikeouts ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
