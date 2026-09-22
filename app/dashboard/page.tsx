'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useEffect } from 'react';
import { HitRateMiniBar } from '../../components/HitRateMiniBar';
import { InfoTooltip } from '../../components/InfoTooltip';
import { PlayerAvatar } from '../../components/PlayerAvatar';
import { StatusBadge } from '../../components/StatusBadge';
import { TeamLogo } from '../../components/TeamLogo';
import { AppSidebar } from '../../components/AppSidebar';
import { NewsAlertsPanel } from '../../components/NewsAlertsPanel';
import { AddPickButton } from '../../components/AddPickButton';
import { getResearchHref } from '../../lib/researchHref';
import { getPropById } from '../research/mockData';
import { dashboardData, sportOptions, type DashboardGame, type DashboardSport } from './mockData';
import type { MLBGame } from '../../lib/mlb/types';

function qualityLabel(confidence: number): { label: string; className: string } {
  if (confidence >= 82) return { label: 'Strong', className: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' };
  if (confidence >= 72) return { label: 'Good', className: 'bg-teal-500/15 text-teal-400 border border-teal-500/25' };
  return { label: 'Neutral', className: 'bg-amber-500/10 text-amber-400 border border-amber-500/20' };
}

function alertIcon(category?: string) {
  switch (category) {
    case 'LINEUP': return '👥';
    case 'WEATHER': return '🌤️';
    case 'PITCHER': return '⚾';
    case 'INJURY': return '🩺';
    case 'MARKET': return '📊';
    default: return '•';
  }
}

function alertAccent(tone: string) {
  if (tone === 'positive') return 'border-l-emerald-500 bg-emerald-500/5';
  if (tone === 'warning') return 'border-l-amber-500 bg-amber-500/5';
  return 'border-l-slate-600 bg-slate-800/30';
}

export default function DashboardPage() {
  const router = useRouter();
  const [selectedSport, setSelectedSport] = useState<DashboardSport>('MLB');
  const [query, setQuery] = useState('');
  const [headerSearch, setHeaderSearch] = useState('');
  const [startHereOpen, setStartHereOpen] = useState(true);
  const [liveGames, setLiveGames] = useState<MLBGame[] | null>(null);
  const [liveGamesError, setLiveGamesError] = useState(false);

  const data = dashboardData[selectedSport];
  const games: DashboardGame[] = selectedSport === 'MLB'
    ? (liveGames ?? []).map((game) => ({
        id: game.id,
        awayTeam: game.awayTeam.name,
        awayTeamId: game.awayTeam.id,
        awayRecord: game.awayTeam.record ? `${game.awayTeam.record.wins}-${game.awayTeam.record.losses}` : 'Data unavailable',
        homeTeam: game.homeTeam.name,
        homeTeamId: game.homeTeam.id,
        homeRecord: game.homeTeam.record ? `${game.homeTeam.record.wins}-${game.homeTeam.record.losses}` : 'Data unavailable',
        time: `${new Date(game.gameTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} • ${game.status}`,
        stadium: game.venue?.stadiumName ?? 'Data unavailable',
        awayPitcherName: game.awayProbableStarter?.name ?? 'Data unavailable',
        homePitcherName: game.homeProbableStarter?.name ?? 'Data unavailable',
        weather: 'Weather data unavailable',
      }))
    : data.games;
  // Computed client-side only to avoid server/client hydration mismatch
  const [today, setToday] = useState('');
  const [dateShort, setDateShort] = useState('');
  useEffect(() => {
    setToday(new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }));
    setDateShort(new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/mlb/schedule')
      .then(async (response) => {
        if (!response.ok) throw new Error('Schedule unavailable');
        return response.json() as Promise<{ data: MLBGame[] }>;
      })
      .then((payload) => {
        if (!cancelled) setLiveGames(payload.data);
      })
      .catch(() => {
        if (!cancelled) setLiveGamesError(true);
      });
    return () => { cancelled = true; };
  }, []);

  const filteredPlayers = useMemo(() => {
    if (!query.trim()) return data.quickPlayers.slice(0, 3);
    const q = query.trim().toLowerCase();
    return data.quickPlayers.filter((p) => p.name.toLowerCase().includes(q));
  }, [data.quickPlayers, query]);

  return (
    <div className="flex h-screen overflow-hidden bg-[#060d18] text-white">
      <AppSidebar currentPath="/dashboard" />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top nav */}
        <header className="flex shrink-0 items-center gap-3 border-b border-white/5 bg-[#0b1522] px-4 py-2.5">
          <label className="flex max-w-sm flex-1 items-center gap-2 rounded-xl border border-white/8 bg-white/5 px-3 py-1.5 text-sm text-slate-400">
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-600"
              placeholder="Search players, teams, props..."
              value={headerSearch}
              onChange={(e) => setHeaderSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && headerSearch.trim()) router.push(`/research?q=${encodeURIComponent(headerSearch.trim())}`); }}
            />
            <kbd className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-600">⌘K</kbd>
          </label>
          <div className="ml-auto flex items-center gap-2">
            <button disabled title="Only MLB is supported today" className="flex cursor-not-allowed items-center gap-1.5 rounded-xl border border-white/8 bg-white/5 px-3 py-1.5 text-sm font-medium text-white opacity-50">
              ⚾ MLB <span className="text-slate-500">▾</span>
            </button>
            <button disabled title="Only today's schedule is supported right now" className="flex cursor-not-allowed items-center gap-1.5 rounded-xl border border-white/8 bg-white/5 px-3 py-1.5 text-sm font-medium text-white opacity-50">
              📅 Today, {dateShort} <span className="text-slate-500">▾</span>
            </button>
            <button disabled title="Notifications are not connected yet" className="relative flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-full border border-white/8 bg-white/5 text-slate-300 opacity-50">
              🔔
            </button>
            <Link href="/account" className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-400 transition hover:bg-emerald-500/30">LR</Link>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="flex gap-5 p-5 pb-10">

            {/* Center column */}
            <div className="flex min-w-0 flex-1 flex-col gap-6">

              {/* Greeting */}
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-bold text-white">Good evening, Lisandro 👋</h1>
                  <p className="mt-1 text-sm text-slate-400">{"Here's your MLB overview for"} {today}</p>
                </div>
                <div className="flex shrink-0 items-center gap-3 rounded-2xl border border-white/8 bg-white/4 p-3 pr-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-base">⭐</div>
                  <div>
                    <p className="text-sm font-semibold text-white">Pro Plan</p>
                    <p className="text-xs text-slate-500">Next billing: Jun 30, 2026</p>
                  </div>
                  <button
                    onClick={() => router.push('/account')}
                    className="rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950 transition hover:bg-emerald-400"
                  >View Plan</button>
                </div>
              </div>

              {/* Daily Snapshot */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-2xl border border-white/5 bg-white/3 px-5 py-3.5">
                {[
                  { value: selectedSport === 'MLB' ? liveGames?.length ?? '—' : data.summary.gamesToday, label: 'Games Today', icon: '🏟️', highlight: false, warn: false },
                  { value: data.summary.propsTracked, label: 'Props Tracked', icon: '📋', highlight: false, warn: false },
                  { value: data.summary.highConfidenceProps, label: 'Strong Opportunities', icon: '🎯', highlight: true, warn: false },
                  { value: data.summary.marketMovers, label: 'Market Movers', icon: '📈', highlight: false, warn: false },
                  { value: data.summary.importantAlerts, label: 'Alerts', icon: '🔔', highlight: false, warn: data.summary.importantAlerts > 0 },
                ].map((s) => (
                  <div key={s.label} className="flex items-center gap-2">
                    <span className="text-lg">{s.icon}</span>
                    <span className={`text-xl font-bold ${s.highlight ? 'text-emerald-400' : s.warn ? 'text-amber-400' : 'text-white'}`}>{s.value}</span>
                    <span className="text-sm text-slate-500">{s.label}</span>
                  </div>
                ))}
              </div>

              {/* Start Here */}
              <div className="overflow-hidden rounded-2xl border border-emerald-500/15 bg-emerald-500/5">
                <button
                  onClick={() => setStartHereOpen((v) => !v)}
                  className="flex w-full items-center justify-between px-5 py-3.5 text-left"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-emerald-400">Start Here</span>
                    <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">Beginner Guide</span>
                  </div>
                  <span className="text-sm text-slate-500">{startHereOpen ? '▲' : '▾'}</span>
                </button>
                {startHereOpen && (
                  <div className="grid gap-3 px-5 pb-5 sm:grid-cols-3">
                    {[
                      { n: '1', icon: '🏟️', title: 'Choose a Game', desc: "See today's MLB matchups, probable pitchers, and conditions.", href: '/matchups' },
                      { n: '2', icon: '🔍', title: 'Research a Player', desc: 'Check recent performance, matchup context, and hit rates.', href: '/research' },
                      { n: '3', icon: '🎯', title: 'Compare Opportunities', desc: 'Use confidence scores and market movement before deciding.', href: '/picks' },
                    ].map((step) => (
                      <Link key={step.n} href={step.href} className="flex items-start gap-3 rounded-xl bg-white/4 p-3.5 transition hover:bg-white/7">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-sm font-bold text-emerald-400">{step.n}</div>
                        <div>
                          <p className="text-sm font-semibold text-white">{step.title}</p>
                          <p className="mt-0.5 text-[11px] leading-relaxed text-slate-400">{step.desc}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              {/* Sport Tabs */}
              <div className="flex flex-wrap items-center gap-1">
                {sportOptions.map((sport) => (
                  <button
                    key={sport}
                    onClick={() => setSelectedSport(sport)}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${selectedSport === sport ? 'bg-emerald-500 text-slate-950' : 'text-slate-500 hover:text-white'}`}
                  >
                    {sport}
                  </button>
                ))}
              </div>

              {/* Today's Games */}
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-semibold text-white">{"Today's Games"}</h2>
                  <Link href="/matchups" className="text-sm text-slate-400 transition hover:text-emerald-400">View Full Schedule →</Link>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {selectedSport === 'MLB' && liveGames === null && !liveGamesError ? <p className="text-sm text-slate-400">Loading today&apos;s MLB games…</p> : null}
                  {selectedSport === 'MLB' && liveGamesError ? <p className="text-sm text-slate-400">Data unavailable.</p> : null}
                  {games.map((game) => (
                    <div key={game.id} className="flex flex-col rounded-2xl border border-white/6 bg-white/3 p-4 transition hover:border-white/12 hover:bg-white/5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-white">{game.time}</span>
                        <span className="text-slate-500">{game.stadium}</span>
                      </div>
                      <div className="mt-4 space-y-3">
                        <div className="flex items-center gap-3">
                          <TeamLogo teamId={game.awayTeamId} abbreviation={game.awayTeam.slice(0, 3).toUpperCase()} teamName={game.awayTeam} size={36} />
                          <div>
                            <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">Away</p>
                            <p className="text-sm font-bold text-white">{game.awayTeam}</p>
                            <p className="text-xs text-slate-500">{game.awayRecord}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="h-px flex-1 bg-white/5" />
                          <span className="text-[10px] text-slate-600">@</span>
                          <div className="h-px flex-1 bg-white/5" />
                        </div>
                        <div className="flex items-center gap-3">
                          <TeamLogo teamId={game.homeTeamId} abbreviation={game.homeTeam.slice(0, 3).toUpperCase()} teamName={game.homeTeam} size={36} />
                          <div>
                            <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">Home</p>
                            <p className="text-sm font-bold text-white">{game.homeTeam}</p>
                            <p className="text-xs text-slate-500">{game.homeRecord}</p>
                          </div>
                        </div>
                      </div>
                      {(game.awayPitcherName || game.homePitcherName) && (
                        <div className="mt-3 rounded-xl bg-white/3 px-3 py-2">
                          <div className="mb-1 flex items-center gap-1">
                            <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-600">Starting Pitchers</p>
                            <InfoTooltip text="ERA (Earned Run Average): how many runs a pitcher allows per 9 innings on average. Lower is better." />
                          </div>
                          <div className="flex items-center justify-between text-[11px] text-slate-300">
                            <span>{game.awayPitcherName ?? 'Data unavailable'}{game.awayPitcherEra ? <span className="text-slate-500"> {game.awayPitcherEra} ERA</span> : null}</span>
                            <span className="text-slate-600">vs</span>
                            <span className="text-right">{game.homePitcherName ?? 'Data unavailable'}{game.homePitcherEra ? <span className="text-slate-500"> {game.homePitcherEra} ERA</span> : null}</span>
                          </div>
                        </div>
                      )}
                      <p className="mt-2 text-[11px] text-slate-600">{game.weatherIcon} {game.weather}</p>
                      <Link href={`/matchups?game=${game.id}`} className="mt-3 flex items-center justify-center rounded-xl border border-white/8 py-2 text-xs font-semibold text-slate-300 transition hover:border-emerald-500/30 hover:text-emerald-400">
                        Research Matchup →
                      </Link>
                    </div>
                  ))}
                </div>
              </section>

              {/* Top Opportunities */}
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h2 className="font-semibold text-white">Top Opportunities</h2>
                    <InfoTooltip text="Opportunities ranked by DeepSide's confidence score — a blend of recent hit rate, matchup quality, and market context." />
                  </div>
                  <Link href="/picks" className="text-sm text-emerald-400 hover:text-emerald-300">View All →</Link>
                </div>
                <div className="overflow-hidden rounded-2xl border border-white/6 bg-white/3 divide-y divide-white/5">
                  {data.opportunities.map((opp, i) => {
                    const quality = qualityLabel(opp.confidence);
                    return (
                      <div key={opp.id} className="flex flex-col gap-4 p-4 transition hover:bg-white/4 md:flex-row md:items-start">
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/5 text-sm font-bold text-slate-400">
                          {i + 1}
                        </div>
                        <div className="flex items-center gap-3 md:w-52 md:shrink-0">
                          <PlayerAvatar playerId={opp.playerId} playerName={opp.player} initials={opp.avatar} size={40} />
                          <div className="min-w-0">
                            <p className="font-semibold text-white">{opp.player}</p>
                            <div className="mt-0.5 flex items-center gap-1.5">
                              <TeamLogo teamId={opp.teamId} abbreviation={opp.team} size={14} />
                              <span className="text-xs text-slate-500">{opp.team} vs {opp.opponent}</span>
                            </div>
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                            <div>
                              <div className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-slate-600">
                                <span>Prop</span><InfoTooltip text="A prop is a bet on a specific player stat — e.g. how many home runs or total bases they get in one game." />
                              </div>
                              <p className="font-semibold text-white">{opp.prop}</p>
                            </div>
                            <div>
                              <div className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-slate-600">
                                <span>Line</span><InfoTooltip text="The number the player must go over or under. Here, Over 0.5 HR means they need at least 1 home run." />
                              </div>
                              <p className="font-semibold text-white">{opp.side} {opp.line}</p>
                            </div>
                            <div>
                              <div className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-slate-600">
                                <span>Odds</span><InfoTooltip text="American odds: -120 means risk $120 to win $100. +105 means risk $100 to win $105." />
                              </div>
                              <p className="font-semibold text-white">{opp.odds ?? '—'}</p>
                            </div>
                          </div>
                          <div className="mt-2.5 space-y-1.5">
                            <div className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-slate-600">
                              Hit Rate <InfoTooltip text="How often this prop would have hit in recent games. L5 = last 5 games, L10 = last 10, L20 = last 20." />
                            </div>
                            <HitRateMiniBar label="L5" value={opp.l5} />
                            <HitRateMiniBar label="L10" value={opp.l10} />
                            <HitRateMiniBar label="L20" value={opp.l20} />
                          </div>
                          {opp.rationale && (
                            <p className="mt-2 text-[11px] italic text-slate-400">&ldquo;{opp.rationale}&rdquo;</p>
                          )}
                        </div>
                        <div className="flex flex-row items-center gap-3 md:flex-col md:items-end">
                          <div className="text-right">
                            <div className="flex items-center gap-1">
                              <span className="text-xl font-bold text-white">{opp.confidence}%</span>
                              <InfoTooltip text="Confidence is DeepSide's overall rating of this opportunity, factoring in trend strength, matchup, and market." />
                            </div>
                            <span className={`mt-0.5 inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold ${quality.className}`}>{quality.label}</span>
                          </div>
                          {opp.playerId != null || getPropById(opp.id) ? (
                            <Link
                              href={getResearchHref({ playerId: opp.playerId, opportunityId: opp.id })}
                              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-400 transition hover:bg-emerald-500/20"
                            >
                              Research →
                            </Link>
                          ) : (
                            <span title={`Research pages aren't available for ${selectedSport} yet`} className="cursor-not-allowed rounded-xl border border-white/8 px-3 py-1.5 text-xs font-semibold text-slate-600">
                              Research unavailable
                            </span>
                          )}
                          <AddPickButton id={opp.id} playerId={opp.playerId} playerName={opp.player} teamId={opp.teamId} teamName={opp.team} opponentName={opp.opponent} gameTime="Tonight" propType={opp.prop} side={opp.side.toLowerCase() as 'over' | 'under'} line={Number(opp.line)} odds={Number(opp.odds)} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <Link href="/picks" className="mt-2 block text-sm text-slate-400 hover:text-emerald-400">View All Opportunities →</Link>
              </section>

              {/* Market Movers */}
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="font-semibold text-white">Market Movers</h2>
                  <InfoTooltip text="Market Movers shows how sportsbook odds have changed since opening. Sharp movement often indicates informed betting action." />
                </div>
                <div className="overflow-hidden rounded-2xl border border-white/6 bg-white/3 divide-y divide-white/5">
                  {data.marketMovers.length === 0 && (
                    <p className="p-4 text-sm text-slate-500">No significant market movement for the selected sport.</p>
                  )}
                  {data.marketMovers.map((mover) => (
                    <div key={mover.id} className="flex flex-col gap-3 p-4 transition hover:bg-white/4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-3">
                        <PlayerAvatar playerId={mover.playerId} playerName={mover.player} size={36} />
                        <div>
                          <p className="font-semibold text-white">{mover.player}</p>
                          <p className="text-xs text-slate-500">{mover.prop}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-center">
                          <p className="text-[9px] uppercase tracking-widest text-slate-600">Open</p>
                          <p className="text-sm font-semibold text-slate-400">{mover.openingOdds}</p>
                        </div>
                        <span className={`text-xl font-bold ${mover.direction === 'down' ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {mover.direction === 'down' ? '↓' : '↑'}
                        </span>
                        <div className="text-center">
                          <p className="text-[9px] uppercase tracking-widest text-slate-600">Now</p>
                          <p className={`text-sm font-bold ${mover.direction === 'down' ? 'text-rose-400' : 'text-emerald-400'}`}>{mover.currentOdds}</p>
                        </div>
                        <div className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${mover.direction === 'down' ? 'border-rose-500/25 bg-rose-500/10 text-rose-400' : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400'}`}>
                          {mover.movement}
                        </div>
                      </div>
                      {mover.movementLabel && (
                        <p className="text-xs italic text-slate-500 sm:max-w-[200px] sm:text-right">&ldquo;{mover.movementLabel}&rdquo;</p>
                      )}
                    </div>
                  ))}
                </div>
              </section>

              {/* Quick Search + Recent Research */}
              <div className="grid gap-4 lg:grid-cols-2">
                <section className="rounded-2xl border border-white/6 bg-white/3 p-4">
                  <h2 className="mb-3 font-semibold text-white">Quick Player Search</h2>
                  <label className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-sm text-slate-400">
                    <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24">
                      <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <input className="flex-1 bg-transparent outline-none placeholder:text-slate-600" placeholder="Search MLB players..." value={query} onChange={(e) => setQuery(e.target.value)} />
                  </label>
                  <div className="mt-3 space-y-2">
                    {filteredPlayers.map((player) => (
                      <Link key={player.id} href={getResearchHref({ playerId: player.playerId })} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/3 px-3 py-2 transition hover:bg-white/7">
                        <PlayerAvatar playerId={player.playerId} playerName={player.name} initials={player.avatar} size={34} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-white">{player.name}</p>
                          <div className="flex items-center gap-1.5">
                            <TeamLogo teamId={player.teamId} abbreviation={player.team.slice(0, 3)} size={13} />
                            <p className="text-xs text-slate-500">{player.team} • {player.position}</p>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                  <Link href="/research" className="mt-3 block text-sm text-emerald-400 hover:text-emerald-300">View Research →</Link>
                </section>

                <section className="rounded-2xl border border-white/6 bg-white/3 p-4">
                  <h2 className="mb-3 font-semibold text-white">Recent Research</h2>
                  <div className="space-y-2">
                    {data.recentResearch.map((item) => (
                      <div key={item.id} className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/3 px-3 py-2">
                        <PlayerAvatar playerId={item.playerId} playerName={item.player} size={34} />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-white">{item.player}</p>
                          <div className="flex items-center gap-1.5">
                            <TeamLogo teamId={item.teamId} size={12} />
                            <p className="text-xs text-slate-500">{item.prop} • {item.line} • {item.lastViewed}</p>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className={`text-xs font-bold rounded-full px-2 py-0.5 ${qualityLabel(item.confidence).className}`}>{item.confidence}%</span>
                          <Link href={getResearchHref({ playerId: item.playerId, opportunityId: item.id })} className="text-[11px] text-emerald-400 hover:text-emerald-300">Continue →</Link>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

            </div>

            {/* Right rail */}
            <aside className="hidden w-[248px] shrink-0 space-y-4 xl:flex xl:flex-col">

              <section className="rounded-2xl border border-white/6 bg-white/3 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-semibold text-white">Game Alerts</h2>
                  <span className="text-xs text-emerald-400">Live updates below</span>
                </div>
                <div className="space-y-2">
                  {data.alerts.map((alert) => (
                    <div key={alert.id} className={`rounded-xl border-l-2 p-3 ${alertAccent(alert.tone)}`}>
                      <div className="flex items-start gap-2">
                        <span className="text-base leading-none">{alertIcon(alert.category)}</span>
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium leading-snug text-white">{alert.message}</p>
                          <div className="mt-1 flex items-center gap-2">
                            <span className="text-[10px] text-slate-500">{alert.time}</span>
                            {alert.category && (
                              <span className="rounded-full bg-white/8 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-400">{alert.category}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <NewsAlertsPanel context={['Yankees', 'Judge', 'MLB']} />

              <section className="rounded-2xl border border-white/6 bg-white/3 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-semibold text-white">Lineup &amp; Injury</h2>
                  <button disabled title="A dedicated injury report page isn't built yet" className="cursor-not-allowed text-xs text-slate-600">View All</button>
                </div>
                <div className="space-y-2.5">
                  {data.injuryNews.map((item) => (
                    <div key={item.id} className="flex items-center gap-2.5">
                      <PlayerAvatar playerId={item.playerId} playerName={item.player} size={30} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-white">{item.player}</p>
                        <p className="text-[10px] text-slate-500">{item.detail}</p>
                      </div>
                      <StatusBadge status={item.status} />
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-white/6 bg-white/3 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-semibold text-white">Saved Picks</h2>
                  <Link href="/picks" className="text-xs text-emerald-400 hover:text-emerald-300">View All</Link>
                </div>
                <div className="space-y-2.5">
                  {data.savedPicks.map((pick) => (
                    <div key={pick.id} className="flex items-center gap-2.5 rounded-xl border border-white/5 bg-white/3 p-2.5">
                      <PlayerAvatar playerId={pick.playerId} playerName={pick.player} size={30} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-white">{pick.player}</p>
                        <div className="flex items-center gap-1">
                          <TeamLogo teamId={pick.teamId} size={11} />
                          <p className="text-[10px] text-slate-500">{pick.side} {pick.line} {pick.prop}</p>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-xs text-slate-400">{pick.odds ?? ''}</p>
                        <p className="text-[10px] text-emerald-400">{pick.confidence}%</p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl border border-white/6 bg-white/3 p-4">
                <h2 className="mb-3 font-semibold text-white">Daily Edge Summary</h2>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { v: '24k', label: 'Top Picks', sub: '+6 today', hl: false },
                    { v: '8', label: 'High Conf.', sub: '>75% hit rate', hl: false },
                    { v: '11', label: 'Value Plays', sub: '10%+ edge', hl: true },
                    { v: '6', label: 'Movers', sub: 'Big line moves', hl: true },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl bg-white/4 p-2.5">
                      <p className={`text-xl font-bold ${s.hl ? 'text-emerald-400' : 'text-white'}`}>{s.v}</p>
                      <p className="text-[11px] font-semibold text-white">{s.label}</p>
                      <p className="text-[10px] text-slate-500">{s.sub}</p>
                    </div>
                  ))}
                </div>
              </section>

            </aside>
            <NewsAlertsPanel className="xl:hidden" context={['Yankees', 'Judge', 'MLB']} />
          </div>
        </main>
      </div>
    </div>
  );
}
