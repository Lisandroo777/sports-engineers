"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AppSidebar } from "../../components/AppSidebar";
import { NewsAlertsPanel } from "../../components/NewsAlertsPanel";
import { AddPickButton } from "../../components/AddPickButton";
import { HitRateMiniBar } from "../../components/HitRateMiniBar";
import { PlayerAvatar } from "../../components/PlayerAvatar";
import { TeamLogo } from "../../components/TeamLogo";
import { TrendSparkline } from "../../components/TrendSparkline";
import { getResearchHref } from "../../lib/researchHref";
import type { FinderResult, FinderRunSummary } from "../../lib/finder/engine";
import { picksData, pickCategories, quickInsights, type PickCategory } from "./mockData";

// ─── constants ─────────────────────────────────────────────────────────────

const SPORT_TABS = ["MLB", "WNBA", "NFL", "NBA", "NHL", "NCAAFB", "Soccer", "UFC"];

const PROP_TYPES = [
  { label: "Home Runs", count: 9 },
  { label: "Total Bases", count: 14 },
  { label: "Hits", count: 12 },
  { label: "Strikeouts", count: 11 },
  { label: "Runs", count: 8 },
  { label: "RBI", count: 8 },
];

const RESEARCH_TOOLS = [
  { icon: "📈", title: "Prop Analyzer", desc: "Analyze any prop with hit rates & matchup context.", cta: "Open Tool", href: "/research" },
  { icon: "📊", title: "Line Tracker", desc: "Track line movement in real-time.", cta: "Open Tool", href: "/research" },
  { icon: "👤", title: "Player Trends", desc: "Deep dive into player performance.", cta: "Open Tool", href: "/research" },
  { icon: "⚡", title: "Matchup Grades", desc: "See pitchers, bullpen & team advantages.", cta: "Open Tool", href: "/matchups" },
  { icon: "🔔", title: "Trend Alerts", desc: "Get notified of trend changes.", cta: "View News & Alerts", href: "/picks" },
  { icon: "📋", title: "Cheat Sheet", desc: "Quick reference for MLB props.", cta: "View Sheet", href: "/research" },
  { icon: "📚", title: "Education Hub", desc: "Learn strategies and analytics.", cta: "View Guides", href: "/research" },
  { icon: "💰", title: "Bankroll Tracker", desc: "Track performance and ROI.", cta: "Open Tracker", href: "/picks" },
  { icon: "⚾", title: "Pitcher Splits", desc: "Research pitchers vs LHP / RHP.", cta: "Open Tool", href: "/matchups" },
  { icon: "🏏", title: "Batter Splits", desc: "Research hitters vs LHP / RHP.", cta: "Open Tool", href: "/research" },
  { icon: "🌤️", title: "Weather Impact", desc: "See how weather affects scoring.", cta: "Open Tool", href: "/matchups" },
  { icon: "🏟️", title: "Park Factors", desc: "Compare stadium hitting environments.", cta: "Open Tool", href: "/matchups" },
];

// ─── helpers ───────────────────────────────────────────────────────────────

function confidenceColor(n: number) {
  if (n >= 80) return "text-emerald-400";
  if (n >= 70) return "text-teal-400";
  return "text-amber-400";
}

function confidenceBg(n: number) {
  if (n >= 80) return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
  if (n >= 70) return "bg-teal-500/15 text-teal-400 border-teal-500/25";
  return "bg-amber-500/15 text-amber-400 border-amber-500/25";
}

function qualityLabel(n: number) {
  if (n >= 80) return "Strong";
  if (n >= 70) return "Good";
  return "Avg";
}

// ─── page ──────────────────────────────────────────────────────────────────

export default function PicksPage() {
  const [sport, setSport] = useState("MLB");
  const [activeTab, setActiveTab] = useState<PickCategory>("Top Picks");
  const [showAllLines, setShowAllLines] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [qSearch, setQSearch] = useState("");
  const [finderSummary, setFinderSummary] = useState<FinderRunSummary | null>(null);
  const [finderLoading, setFinderLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/finder/mlb/deep-search")
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { data: FinderRunSummary } | null) => { if (!cancelled && payload) setFinderSummary(payload.data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setFinderLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const toggleSave = (id: string) =>
    setSavedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const filteredPicks = useMemo(() => {
    let picks = picksData.filter((p) => {
      if (activeTab === "High Confidence") return p.confidence >= 75;
      if (activeTab === "Value") return p.projectedEdge >= 5;
      if (activeTab === "Trending") return p.recentFormScore >= 7;
      if (activeTab === "Market Movers") return p.marketMovementScore >= 7.5;
      if (activeTab === "My Saved") return savedIds.has(p.id);
      return true;
    });
    return picks.sort((a, b) => b.confidence - a.confidence);
  }, [activeTab, savedIds]);

  const topCards = filteredPicks.slice(0, 5);
  const queueRows = filteredPicks.slice(0, 10);

  const filteredQPlayers = useMemo(() => {
    const players = [
      { id: "p1", name: "Aaron Judge", playerId: 592450, team: "Yankees", teamId: 147, position: "OF" },
      { id: "p2", name: "Shohei Ohtani", playerId: 660271, team: "Dodgers", teamId: 119, position: "DH" },
      { id: "p3", name: "Juan Soto", playerId: 665742, team: "Yankees", teamId: 147, position: "OF" },
      { id: "p4", name: "Mookie Betts", playerId: 605141, team: "Dodgers", teamId: 119, position: "RF" },
      { id: "p5", name: "Julio Rodriguez", playerId: 677594, team: "Mariners", teamId: 136, position: "OF" },
    ];
    if (!qSearch.trim()) return players;
    const q = qSearch.trim().toLowerCase();
    return players.filter((p) => p.name.toLowerCase().includes(q));
  }, [qSearch]);

  const strongCount = filteredPicks.filter((p) => p.confidence >= 75).length;
  const goodCount = filteredPicks.filter((p) => p.confidence >= 60 && p.confidence < 75).length;
  const avgCount = filteredPicks.filter((p) => p.confidence >= 45 && p.confidence < 60).length;
  const poorCount = filteredPicks.filter((p) => p.confidence < 45).length;

  return (
    <div className="flex h-screen overflow-hidden bg-[#060d18] text-white">
      <AppSidebar currentPath="/picks" />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top nav */}
        <header className="flex shrink-0 items-center gap-3 border-b border-white/5 bg-[#0b1522] px-4 py-2.5">
          <label className="flex max-w-sm flex-1 items-center gap-2 rounded-xl border border-white/8 bg-white/5 px-3 py-1.5 text-sm text-slate-400">
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-600" placeholder="Search players, teams, props..." />
            <kbd className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-600">K</kbd>
          </label>
          <div className="ml-auto flex items-center gap-2">
            <button className="flex items-center gap-1.5 rounded-xl border border-white/8 bg-white/5 px-3 py-1.5 text-sm font-medium text-white">
              MLB <span className="text-slate-500">v</span>
            </button>
            <button className="flex items-center gap-1.5 rounded-xl border border-white/8 bg-white/5 px-3 py-1.5 text-sm font-medium text-white">
              Today, Aug 9 <span className="text-slate-500">v</span>
            </button>
            <button className="relative flex h-8 w-8 items-center justify-center rounded-full border border-white/8 bg-white/5 text-slate-300">
              <span>B</span>
              <span className="absolute right-0 top-0 h-2 w-2 rounded-full bg-emerald-500" />
            </button>
            <button className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-400">LR</button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="space-y-5 p-5 pb-10">

            {/* Title + Edge Insights */}
            <div className="flex flex-wrap items-start justify-between gap-5">
              <div>
                <h1 className="text-2xl font-bold text-white">Picks</h1>
                <p className="mt-1 text-sm text-slate-400">Find the best prop opportunities with real edge.</p>
              </div>
              <div className="w-full rounded-2xl border border-white/6 bg-white/3 p-4 xl:w-[300px]">
                <div className="mb-3 flex items-center gap-2">
                  <h2 className="font-semibold text-white">Edge Insights</h2>
                  <span className="flex h-4 w-4 items-center justify-center rounded-full border border-white/20 text-[9px] text-slate-500">?</span>
                </div>
                <div className="space-y-2">
                  {quickInsights.map((insight) => (
                    <div key={insight} className="flex items-start gap-2 border-b border-white/5 pb-2 last:border-0 last:pb-0">
                      <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                      <p className="text-[11px] leading-snug text-slate-400">{insight}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Sport tabs */}
            <div className="flex flex-wrap items-center gap-1">
              {SPORT_TABS.map((s) => (
                <button
                  key={s}
                  onClick={() => setSport(s)}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${sport === s ? "bg-emerald-500 text-slate-950" : "text-slate-500 hover:text-white"}`}
                >
                  {s}
                </button>
              ))}
            </div>

            {/* AI Finder Picks — real FinderScore output, reused from the cached Odds/MLB slate analysis */}
            <div className="rounded-2xl border border-[#39f27f]/25 bg-[#0c1410] p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h2 className="font-semibold text-white">AI Finder Picks</h2>
                  <p className="text-[11px] text-slate-500">Real FinderScores from MLB Stats API + Odds API, reused from the shared cache (no extra credits spent).</p>
                </div>
                {finderSummary && <p className="text-[10px] text-slate-500">Games: {finderSummary.gamesAnalyzed} • Props: {finderSummary.propsAnalyzed} • Books: {finderSummary.booksAnalyzed}</p>}
              </div>
              {finderSummary && (
                <p className="mb-2 rounded-lg border border-white/8 bg-black/20 px-3 py-1.5 font-mono text-[10px] text-slate-500">
                  [dev] source={finderSummary.fromCache ? "cache" : "network"} • cacheAge={finderSummary.cacheAgeMs != null ? `${Math.round(finderSummary.cacheAgeMs / 1000)}s` : "n/a"} • credits.remaining={finderSummary.credits?.remaining ?? "unknown"}{finderSummary.budgetLimited ? " • BUDGET-LIMITED" : ""}
                </p>
              )}
              {finderLoading && <p className="text-sm text-slate-500">Loading real Finder results…</p>}
              {!finderLoading && (!finderSummary || finderSummary.results.length === 0) && <p className="text-sm text-slate-500">No AI Finder picks currently meet the minimum criteria.</p>}
              {!finderLoading && finderSummary && finderSummary.results.length > 0 && (
                <div className="flex gap-3 overflow-x-auto pb-1">
                  {finderSummary.results.slice(0, 8).map((result: FinderResult) => (
                    <div key={result.id} className="w-[220px] shrink-0 rounded-xl border border-white/8 bg-white/3 p-3">
                      <div className="flex items-center gap-2">
                        <PlayerAvatar playerId={result.playerId ?? undefined} playerName={result.player} size={30} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-white">{result.player}</p>
                          <p className="truncate text-[11px] text-slate-500">{result.side === "over" ? "Over" : "Under"} {result.line} {result.marketLabel}</p>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-lg font-extrabold text-[#39f27f]">{result.finderScore}</span>
                        {result.evPercent != null && <span className={`text-xs font-semibold ${result.evPercent > 0 ? "text-emerald-400" : "text-slate-500"}`}>{result.evPercent > 0 ? "+" : ""}{result.evPercent.toFixed(1)}% EV</span>}
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        {result.playerId ? <Link href={getResearchHref({ playerId: result.playerId })} className="text-[10px] font-semibold text-emerald-400">Research</Link> : <span className="text-[10px] text-slate-600">Player ID unavailable</span>}
                        {result.bestBook && <AddPickButton id={result.id} playerId={result.playerId ?? undefined} playerName={result.player} teamName="Data unavailable" opponentName="Data unavailable" gameId={result.gameId} gameTime="" propType={result.marketLabel} side={result.side} line={result.line} odds={result.bestBook.odds} />}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Summary stats */}
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {[
                { label: "Top Picks Today", value: Math.min(filteredPicks.length, 28), sub: "+7 from yesterday", spark: [22, 24, 21, 25, 26, 28] },
                { label: "High Confidence", value: strongCount, sub: "> 75% confidence", spark: [6, 7, 8, 9, 8, strongCount] },
                { label: "Value Plays", value: filteredPicks.filter((p) => p.projectedEdge >= 5).length, sub: "Positive projected edge", spark: [8, 9, 11, 10, 12, 10] },
                { label: "Saved Picks", value: savedIds.size || 8, sub: "Tracked for today", spark: [5, 6, 7, 8, 8, savedIds.size || 8] },
              ].map((stat) => (
                <div key={stat.label} className="rounded-2xl border border-white/6 bg-white/3 px-4 py-3">
                  <p className="text-[10px] text-slate-500">{stat.label}</p>
                  <div className="mt-2 flex items-end justify-between">
                    <div>
                      <p className="text-3xl font-bold text-white">{stat.value}</p>
                      <p className="text-[10px] text-slate-500">{stat.sub}</p>
                    </div>
                    <TrendSparkline values={stat.spark} positive />
                  </div>
                </div>
              ))}
            </div>

            {/* Filter pills */}
            <div className="flex flex-wrap items-center gap-2">
              <button className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-sm text-white">
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24"><path d="M3 6h18M6 12h12M10 18h4" /></svg>
                Filters
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[9px] font-bold text-slate-950">1</span>
              </button>
              {["Propositions", "Players", "Games", "Over / Under", "Min. Confidence"].map((f) => (
                <button key={f} className="flex items-center gap-1 rounded-xl border border-white/8 bg-white/3 px-3 py-1.5 text-sm text-slate-400 hover:border-white/15 hover:text-white">
                  {f} <span className="text-[10px]">v</span>
                </button>
              ))}
            </div>

            {/* View tabs + count + toggle */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1">
                {pickCategories.map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${activeTab === tab ? "bg-white/10 text-white" : "text-slate-500 hover:text-white"}`}
                  >
                    {tab}
                  </button>
                ))}
                <button
                  onClick={() => setActiveTab("My Saved")}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors ${activeTab === "My Saved" ? "bg-white/10 text-white" : "text-slate-500 hover:text-white"}`}
                >
                  My Saved
                </button>
                <div className="ml-2 flex items-center gap-2 border-l border-white/10 pl-3">
                  <span className="text-xs text-slate-500">Show all lines</span>
                  <button
                    onClick={() => setShowAllLines((v) => !v)}
                    className={`relative h-5 w-9 rounded-full transition-colors ${showAllLines ? "bg-emerald-500" : "bg-slate-700"}`}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${showAllLines ? "translate-x-4" : "translate-x-0.5"}`} />
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-slate-500">{filteredPicks.length} opportunities</span>
                <Link href="/research" className="text-sm text-emerald-400 hover:text-emerald-300">View all insights</Link>
              </div>
            </div>

            {/* Horizontal card scroll */}
            <div className="flex gap-3 overflow-x-auto pb-1">
              {topCards.map((pick) => (
                <div key={pick.id} className="flex min-w-[200px] shrink-0 flex-col rounded-2xl border border-white/6 bg-white/3 p-4 transition hover:border-white/12 hover:bg-white/5">
                  {/* Headshot + team logo */}
                  <div className="relative mb-3 self-start">
                    <PlayerAvatar playerId={pick.mlbPlayerId} playerName={pick.playerName} initials={pick.playerImageUrl} size={52} className="ring-1 ring-white/10" />
                    <TeamLogo teamId={pick.teamId} abbreviation={pick.teamLogoUrl} size={18} className="absolute -bottom-1 -right-1 ring-1 ring-[#060d18]" />
                  </div>

                  <p className="text-sm font-bold text-white">{pick.playerName}</p>
                  <p className="text-[10px] text-slate-500">{pick.team} {pick.opponent}</p>

                  <div className="mt-2.5 flex items-baseline gap-1.5">
                    <span className={`text-2xl font-extrabold ${confidenceColor(pick.confidence)}`}>{pick.confidence}%</span>
                    <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${confidenceBg(pick.confidence)}`}>{qualityLabel(pick.confidence)}</span>
                  </div>

                  <p className="mt-1 text-xs font-semibold text-white">{pick.line} {pick.market}</p>
                  <p className="text-[10px] text-slate-500">{pick.odds}</p>

                  <div className="mt-2.5 space-y-1">
                    <HitRateMiniBar label="L5" value={pick.l5} />
                    <HitRateMiniBar label="L10" value={pick.l10} />
                    <HitRateMiniBar label="L20" value={pick.l20} />
                    <HitRateMiniBar label="L40" value={pick.l40} />
                    <HitRateMiniBar label="2026" value={pick.season2026} />
                  </div>

                  <Link href={pick.researchHref} className="mt-3 flex items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 py-1.5 text-[11px] font-semibold text-emerald-400 transition hover:bg-emerald-500/20">
                    Research
                  </Link>
                </div>
              ))}
            </div>

            {/* Research Queue */}
            <section className="overflow-hidden rounded-2xl border border-white/6 bg-white/3">
              <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
                <h2 className="font-semibold text-white">Research Queue <span className="text-xs text-slate-500">(Top 10)</span></h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px]">
                  <thead>
                    <tr className="border-b border-white/5 text-left text-[9px] font-semibold uppercase tracking-widest text-slate-600">
                      <th className="px-4 py-2">Rank</th>
                      <th className="px-2 py-2">Player</th>
                      <th className="px-2 py-2">Team</th>
                      <th className="px-2 py-2">Opponent</th>
                      <th className="px-2 py-2">Prop</th>
                      <th className="px-2 py-2">Line</th>
                      <th className="px-2 py-2">Odds</th>
                      <th className="px-2 py-2">L10</th>
                      <th className="px-2 py-2">Conf.</th>
                      <th className="px-2 py-2">Edge</th>
                      <th className="px-2 py-2">Trend</th>
                      <th className="px-4 py-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queueRows.map((pick, i) => (
                      <tr key={pick.id} className="border-b border-white/4 last:border-0 transition hover:bg-white/4">
                        <td className="px-4 py-2.5 text-sm font-bold text-slate-500">{i + 1}</td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center gap-2">
                            <PlayerAvatar playerId={pick.mlbPlayerId} playerName={pick.playerName} initials={pick.playerImageUrl} size={28} />
                            <p className="text-xs font-semibold text-white">{pick.playerName}</p>
                          </div>
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center gap-1">
                            <TeamLogo teamId={pick.teamId} abbreviation={pick.teamLogoUrl} size={16} />
                            <span className="text-[10px] text-slate-500">{pick.teamLogoUrl}</span>
                          </div>
                        </td>
                        <td className="px-2 py-2.5">
                          <div className="flex items-center gap-1">
                            <TeamLogo teamId={pick.opponentTeamId} abbreviation={pick.opponent.replace("vs ", "").replace("@ ", "").slice(0, 3)} size={16} />
                            <span className="text-[10px] text-slate-500">{pick.opponent.replace("vs ", "").replace("@ ", "").slice(0, 3)}</span>
                          </div>
                        </td>
                        <td className="px-2 py-2.5 text-xs text-slate-300">{pick.market}</td>
                        <td className="px-2 py-2.5 text-xs text-slate-300">{pick.line.replace("Over ", "")}</td>
                        <td className={`px-2 py-2.5 text-xs font-semibold ${pick.odds.startsWith("+") ? "text-emerald-400" : "text-rose-400"}`}>{pick.odds}</td>
                        <td className={`px-2 py-2.5 text-xs font-semibold ${pick.l10 >= 70 ? "text-emerald-400" : "text-slate-300"}`}>{pick.l10}%</td>
                        <td className="px-2 py-2.5">
                          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${confidenceBg(pick.confidence)}`}>{pick.confidence}%</span>
                        </td>
                        <td className="px-2 py-2.5 text-xs font-semibold text-emerald-400">+{pick.projectedEdge.toFixed(1)}%</td>
                        <td className="px-2 py-2.5">
                          <TrendSparkline values={[pick.l40, pick.l20, pick.l10, pick.l5]} />
                        </td>
                        <td className="px-4 py-2.5">
                          <button
                            onClick={() => toggleSave(pick.id)}
                            className={`rounded-lg border px-2 py-1 text-[10px] transition ${savedIds.has(pick.id) ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-400" : "border-white/10 text-slate-500 hover:border-white/20 hover:text-white"}`}
                          >
                            {savedIds.has(pick.id) ? "Saved" : "Save"}
                          </button>
                          <AddPickButton id={pick.id} playerId={pick.mlbPlayerId} playerName={pick.playerName} teamId={pick.teamId} teamName={pick.team} opponentName={pick.opponent} gameTime="Tonight" propType={pick.market} side={pick.side.toLowerCase() as 'over' | 'under'} line={Number(pick.line.replace(/[^0-9.]/g, ''))} odds={Number(pick.odds)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-white/5 px-4 py-3">
                <Link href="/research" className="text-xs text-emerald-400 hover:text-emerald-300">View full queue</Link>
              </div>
            </section>

            {/* 4-column bottom panels */}
            <div className="grid gap-4 xl:grid-cols-4">
              {/* Quick Player Search */}
              <section className="rounded-2xl border border-white/6 bg-white/3 p-4">
                <h2 className="mb-3 text-sm font-semibold text-white">Quick Player Search</h2>
                <label className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/5 px-3 py-2 text-sm text-slate-400">
                  <svg className="h-3 w-3 shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24">
                    <path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input className="flex-1 bg-transparent outline-none placeholder:text-slate-600 text-xs" placeholder="Search MLB players..." value={qSearch} onChange={(e) => setQSearch(e.target.value)} />
                </label>
                <div className="mt-3 space-y-2">
                  {filteredQPlayers.map((player) => (
                    <Link key={player.id} href="/research" className="flex items-center gap-2 rounded-xl border border-white/5 bg-white/3 px-2.5 py-1.5 transition hover:bg-white/7">
                      <PlayerAvatar playerId={player.playerId} playerName={player.name} size={26} />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-white">{player.name}</p>
                        <div className="flex items-center gap-1">
                          <TeamLogo teamId={player.teamId} size={10} />
                          <p className="text-[9px] text-slate-500">{player.team} - {player.position}</p>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
                <Link href="/research" className="mt-3 block text-xs text-emerald-400 hover:text-emerald-300">View all players</Link>
              </section>

              {/* Today's Research Snapshot */}
              <section className="rounded-2xl border border-white/6 bg-white/3 p-4">
                <h2 className="mb-3 text-sm font-semibold text-white">{"Today's Research Snapshot"}</h2>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: filteredPicks.length, label: "Total opps", sub: "All sports", icon: "📋" },
                    { value: strongCount, label: "Strong 75%+", sub: "> 75% conf.", icon: "🎯" },
                    { value: filteredPicks.filter((p) => p.marketMovementScore >= 7.5).length, label: "Market Movers", sub: "Sharp action", icon: "📈" },
                    { value: 24, label: "Players Tracked", sub: "Active today", icon: "👤" },
                  ].map((s) => (
                    <div key={s.label} className="rounded-xl bg-white/4 p-2.5 text-center">
                      <p className="text-lg">{s.icon}</p>
                      <p className="text-xl font-bold text-white">{s.value}</p>
                      <p className="text-[10px] font-semibold text-white">{s.label}</p>
                      <p className="text-[9px] text-slate-500">{s.sub}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-center text-[9px] text-slate-600">Updated just now</p>
              </section>

              {/* Confidence Breakdown */}
              <section className="rounded-2xl border border-white/6 bg-white/3 p-4">
                <h2 className="mb-3 text-sm font-semibold text-white">Confidence Breakdown</h2>
                <div className="flex items-center gap-4">
                  {/* Simple donut placeholder */}
                  <div className="relative flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-white/5">
                    <svg viewBox="0 0 36 36" className="h-20 w-20 -rotate-90">
                      <circle cx="18" cy="18" r="14" fill="none" stroke="#10b981" strokeWidth="4" strokeDasharray={`${(strongCount / filteredPicks.length) * 88} 88`} />
                      <circle cx="18" cy="18" r="14" fill="none" stroke="#14b8a6" strokeWidth="4" strokeDasharray={`${(goodCount / filteredPicks.length) * 88} 88`} strokeDashoffset={`-${(strongCount / filteredPicks.length) * 88}`} />
                      <circle cx="18" cy="18" r="14" fill="none" stroke="#f59e0b" strokeWidth="4" strokeDasharray={`${(avgCount / filteredPicks.length) * 88} 88`} strokeDashoffset={`-${((strongCount + goodCount) / filteredPicks.length) * 88}`} />
                    </svg>
                    <div className="absolute text-center">
                      <p className="text-xs font-bold text-white">{filteredPicks.length}</p>
                      <p className="text-[8px] text-slate-500">total</p>
                    </div>
                  </div>
                  <div className="min-w-0 space-y-1.5 text-[10px]">
                    {[
                      { label: "Strong (75%+)", count: strongCount, color: "bg-emerald-500" },
                      { label: "Good (60-75%)", count: goodCount, color: "bg-teal-500" },
                      { label: "Average (45-60%)", count: avgCount, color: "bg-amber-500" },
                      { label: "Poor (<30%)", count: poorCount, color: "bg-rose-500" },
                    ].map((item) => (
                      <div key={item.label} className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className={`h-2 w-2 shrink-0 rounded-full ${item.color}`} />
                          <span className="text-slate-400">{item.label}</span>
                        </div>
                        <span className="font-semibold text-white">{item.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              {/* Prop Types Today */}
              <section className="rounded-2xl border border-white/6 bg-white/3 p-4">
                <h2 className="mb-3 text-sm font-semibold text-white">Prop Types Today</h2>
                <div className="space-y-1.5">
                  {PROP_TYPES.map((pt) => (
                    <div key={pt.label} className="flex items-center gap-2 text-xs">
                      <span className="w-20 shrink-0 text-[10px] text-slate-400">{pt.label}</span>
                      <div className="flex-1 rounded-full bg-white/5" style={{ height: 5 }}>
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(pt.count / 14) * 100}%` }} />
                      </div>
                      <span className="w-4 shrink-0 text-right font-semibold text-white">{pt.count}</span>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {/* Research Tools grid */}
            <section>
              <h2 className="mb-3 font-semibold text-white">Research Tools &amp; Insights</h2>
              <div className="grid gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
                {RESEARCH_TOOLS.map((tool) => (
                  <div key={tool.title} className="flex flex-col rounded-2xl border border-white/6 bg-white/3 p-3.5 transition hover:border-white/12 hover:bg-white/5">
                    <span className="text-xl">{tool.icon}</span>
                    <p className="mt-2 text-sm font-semibold text-emerald-400">{tool.title}</p>
                    <p className="mt-1 flex-1 text-[10px] leading-relaxed text-slate-400">{tool.desc}</p>
                    <Link href={tool.href} className="mt-2.5 text-[11px] font-semibold text-slate-300 hover:text-emerald-400">
                      {tool.cta} &rarr;
                    </Link>
                  </div>
                ))}
              </div>
            </section>

            {/* Beginner Guide */}
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/6 bg-white/3 p-5">
              <div>
                <h2 className="font-semibold text-white">How to Research a Prop <span className="text-sm text-slate-400">(Beginner Guide)</span></h2>
                <p className="mt-1 text-sm text-slate-400">Follow a simple step-by-step checklist before researching any player prop.</p>
              </div>
              <Link href="/research" className="flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-emerald-400">
                Start Guide &rarr;
              </Link>
            </div>

            <NewsAlertsPanel context={['Judge', 'Ohtani', 'Yankees', 'Dodgers']} />

          </div>
        </main>
      </div>
    </div>
  );
}
