"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { AppSidebar } from "../../components/AppSidebar";
import { NewsAlertsPanel } from "../../components/NewsAlertsPanel";
import { AddPickButton } from "../../components/AddPickButton";
import { InfoTooltip } from "../../components/InfoTooltip";
import { PlayerAvatar } from "../../components/PlayerAvatar";
import { TeamLogo } from "../../components/TeamLogo";
import { TrendSparkline } from "../../components/TrendSparkline";
import { getResearchHref } from "../../lib/researchHref";
import { AlertsTab, InsightsTab, LineupTab, OddsTab, PropsTab, TrendsTab } from "./tabComponents";
import { type Batter } from "./mockData";
import { buildLiveMatchupData, splitRecord } from "./liveAdapter";
import type { MLBGame, MLBProbablePitcher, MLBTeamRecord } from "../../lib/mlb/types";
import type { NormalizedProp } from "../../lib/odds/types";

// ─── types ────────────────────────────────────────────────────────────────────

type MatchupTab = "Matchup" | "Lineups" | "Props" | "Odds" | "Trends" | "Insights" | "Alerts";
type SplitTab = "vs LHB" | "vs RHB" | "Overall";

// ─── constants ────────────────────────────────────────────────────────────────

const TABS: MatchupTab[] = ["Matchup", "Lineups", "Props", "Odds", "Trends", "Insights", "Alerts"];

const RISK_COLORS = {
  HIGH: "border-rose-500/40 bg-rose-500/10 text-rose-400",
  MEDIUM: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  LOW: "border-slate-600 bg-slate-800/50 text-slate-400",
};

const RESEARCH_TOOLS = [
  { icon: "📈", title: "Prop Analyzer", desc: "Analyze props with hit rates & matchup context.", cta: "Open Tool", href: "/research" },
  { icon: "📊", title: "Line Tracker", desc: "Track line movement in real-time.", cta: "Open Tool", href: "/research" },
  { icon: "👤", title: "Player Trends", desc: "Deep dive into player performance.", cta: "Open Tool", href: "/research" },
  { icon: "⚡", title: "Matchup Grades", desc: "Compare advantages & team matchups.", cta: "Open Tool", href: "/matchups" },
  { icon: "🔔", title: "Trend Alerts", desc: "Get notified of trend changes.", cta: "View News & Alerts", href: "/matchups" },
  { icon: "📋", title: "Cheat Sheet", desc: "Quick reference for MLB props.", cta: "Open Tool", href: "/research" },
  { icon: "🌤️", title: "Weather Impact", desc: "Detailed weather & park analysis.", cta: "Open Tool", href: "/matchups" },
  { icon: "🏟️", title: "Park Factors", desc: "Compare stadium hitting environments.", cta: "Open Tool", href: "/matchups" },
];

// ─── helpers ──────────────────────────────────────────────────────────────────

function GameResults({ results }: { results: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {results.map((r, i) => (
        <span key={i} className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold ${r === "W" ? "bg-emerald-500 text-slate-950" : "bg-rose-500/80 text-white"}`}>{r}</span>
      ))}
    </div>
  );
}

function ScoreGauge({ score }: { score: number }) {
  const color = score >= 8 ? "text-emerald-400" : score >= 7 ? "text-teal-400" : "text-amber-400";
  const label = score >= 8 ? "Strong" : score >= 7 ? "Good" : "Neutral";
  const bg = score >= 8 ? "bg-emerald-500/15 text-emerald-400" : score >= 7 ? "bg-teal-500/15 text-teal-400" : "bg-amber-500/15 text-amber-400";
  return (
    <div className="flex items-center gap-1.5">
      <span className={`text-xl font-extrabold ${color}`}>{score.toFixed(1)}</span>
      <div>
        <p className="text-[9px] text-slate-500">/10</p>
        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${bg}`}>{label}</span>
      </div>
    </div>
  );
}

/** Horizontal stat bar for pitcher metrics — color based on team side */
function PitcherStatBar({ label, value, isAway, invert = false }: { label: string; value: string; isAway: boolean; invert?: boolean }) {
  const num = parseFloat(value.replace('%', ''));
  let pct = 50;
  // Normalize to 0-100% bar fill
  if (label === 'xFIP' || label === 'FIP' || label === 'SIERA' || label === 'ERA') {
    pct = Math.max(5, Math.min(95, ((5.5 - num) / 3.0) * 100));
  } else if (label === 'WHIP') {
    pct = Math.max(5, Math.min(95, ((1.5 - num) / 0.6) * 100));
  } else if (label.includes('K-BB')) {
    pct = Math.max(5, Math.min(95, (num / 30) * 100));
  }
  if (invert) pct = 100 - pct;
  const barColor = isAway ? "bg-red-400/80" : "bg-blue-500/70";
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-14 shrink-0 text-slate-500">{label}</span>
      <div className="flex-1 overflow-hidden rounded-full bg-white/5" style={{ height: 5 }}>
        <div className={`h-full rounded-full ${barColor}`} style={{ width: pct + "%" }} />
      </div>
      <span className="w-9 shrink-0 text-right font-semibold text-white">{value}</span>
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function MatchupsPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center bg-[#060d18] text-sm text-slate-400">Loading today&apos;s MLB games…</div>}>
      <MatchupsPageContent />
    </Suspense>
  );
}

function MatchupsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [games, setGames] = useState<MLBGame[]>([]);
  const [gamesLoading, setGamesLoading] = useState(true);
  const [gamesError, setGamesError] = useState(false);
  const [selectedId, setSelectedId] = useState("");
  const [awayPitcherStats, setAwayPitcherStats] = useState<MLBProbablePitcher | null>(null);
  const [homePitcherStats, setHomePitcherStats] = useState<MLBProbablePitcher | null>(null);
  const [awayTeamRecord, setAwayTeamRecord] = useState<MLBTeamRecord | null>(null);
  const [homeTeamRecord, setHomeTeamRecord] = useState<MLBTeamRecord | null>(null);
  const [realProps, setRealProps] = useState<NormalizedProp[]>([]);
  const [realPropsLoadedFor, setRealPropsLoadedFor] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<MatchupTab>("Matchup");
  const [isAdvanced, setIsAdvanced] = useState(true);
  const [selectedBatter, setSelectedBatter] = useState<Batter | null>(null);
  const [splitTab, setSplitTab] = useState<SplitTab>("vs LHB");
  const [alertDismissed, setAlertDismissed] = useState(false);
  const [todayLabel, setTodayLabel] = useState("");

  useEffect(() => {
    setTodayLabel(new Date().toLocaleDateString('en-US', { weekday: undefined, month: 'short', day: 'numeric' }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/mlb/schedule')
      .then(async (response) => { if (!response.ok) throw new Error('Schedule unavailable'); return response.json() as Promise<{ data: MLBGame[] }>; })
      .then((payload) => {
        if (cancelled) return;
        setGames(payload.data);
        const fromUrl = searchParams.get('game');
        const initial = payload.data.find((entry) => entry.id === fromUrl) ?? payload.data[0];
        if (initial) setSelectedId(initial.id);
      })
      .catch(() => { if (!cancelled) setGamesError(true); })
      .finally(() => { if (!cancelled) setGamesLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function selectGame(id: string) {
    setSelectedId(id);
    router.replace(`/matchups?game=${id}`, { scroll: false });
  }

  const selectedGame = useMemo(() => games.find((entry) => entry.id === selectedId) ?? null, [games, selectedId]);

  useEffect(() => {
    if (!selectedGame) return;
    setAwayPitcherStats(null); setHomePitcherStats(null); setAwayTeamRecord(null); setHomeTeamRecord(null);
    const awayPitcherId = selectedGame.awayProbableStarter?.id;
    const homePitcherId = selectedGame.homeProbableStarter?.id;
    if (awayPitcherId) fetch(`/api/mlb/pitchers/${awayPitcherId}/season`).then((r) => r.ok ? r.json() : null).then((p) => p && setAwayPitcherStats(p.data)).catch(() => {});
    if (homePitcherId) fetch(`/api/mlb/pitchers/${homePitcherId}/season`).then((r) => r.ok ? r.json() : null).then((p) => p && setHomePitcherStats(p.data)).catch(() => {});
    fetch(`/api/mlb/teams/${selectedGame.awayTeam.id}/record`).then((r) => r.ok ? r.json() : null).then((p) => p && setAwayTeamRecord(p.data)).catch(() => {});
    fetch(`/api/mlb/teams/${selectedGame.homeTeam.id}/record`).then((r) => r.ok ? r.json() : null).then((p) => p && setHomeTeamRecord(p.data)).catch(() => {});
    setRealProps([]); setRealPropsLoadedFor(null);
  }, [selectedGame]);

  // Only requested on-demand (Props tab) to protect the free-tier odds API credit quota.
  useEffect(() => {
    if (activeTab !== 'Props' || !selectedGame || realPropsLoadedFor === selectedGame.id) return;
    setRealPropsLoadedFor(selectedGame.id);
    fetch(`/api/odds/mlb/game-props?home=${encodeURIComponent(selectedGame.homeTeam.name)}&away=${encodeURIComponent(selectedGame.awayTeam.name)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((p) => setRealProps(p?.data?.props ?? []))
      .catch(() => setRealProps([]));
  }, [activeTab, selectedGame, realPropsLoadedFor]);

  const matchup = useMemo(
    () => selectedGame ? buildLiveMatchupData(selectedGame, awayPitcherStats, homePitcherStats, awayTeamRecord, homeTeamRecord, realProps) : null,
    [selectedGame, awayPitcherStats, homePitcherStats, awayTeamRecord, homeTeamRecord, realProps]
  );

  if (gamesLoading) {
    return <div className="flex h-screen items-center justify-center bg-[#060d18] text-sm text-slate-400">Loading today&apos;s MLB games…</div>;
  }

  if (gamesError || !matchup || !selectedGame) {
    return <div className="flex h-screen items-center justify-center bg-[#060d18] text-sm text-slate-400">Data unavailable.</div>;
  }

  const { game, awayPitcher, homePitcher, awayLineup, homeLineup,
    awaySplit, homeSplit, awayForm, homeForm,
    awayRecentGames, homeRecentGames, headToHead,
    relevantProps, playersToWatch, propAngles, bvpAway, bvpHome } = matchup;

  // ── Sidebar footer content ─────────────────────────────────────────────────
  const sidebarFooter = (
    <>
      {/* Players to Watch */}
      {playersToWatch && playersToWatch.length > 0 && (
        <div className="mt-4 border-t border-white/5 pt-4">
          <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-white">
            <span>👥</span> Players to Watch
          </p>
          <div className="space-y-2.5">
            {playersToWatch.map((p) => {
              const batter = [...awayLineup, ...homeLineup].find(b => b.name === p.player);
              return (
                <button key={`${p.playerId}-${p.player}`} onClick={() => batter && setSelectedBatter(batter)}
                  className="flex w-full items-center gap-2.5 rounded-xl border border-white/5 bg-white/3 px-2.5 py-2 text-left transition hover:bg-white/7">
                  <div className="relative shrink-0">
                    <PlayerAvatar playerId={p.playerId} playerName={p.player} size={34} />
                    <TeamLogo teamId={p.teamId} abbreviation={p.team.slice(0,3)} size={12} className="absolute -bottom-0.5 -right-0.5 ring-1 ring-[#060d18]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-white">{p.player}</p>
                    <p className="text-[9px] text-slate-500">{p.note}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-extrabold text-emerald-400">{p.score}</p>
                    <p className="text-[8px] text-slate-600">/10</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Data Status */}
      <div className="mt-4 border-t border-white/5 pt-4">
        <p className="mb-2 text-xs font-semibold text-white">Data Status</p>
        <div className="flex items-center gap-2 text-[11px]">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="font-semibold text-emerald-400">LIVE MLB DATA</span>
        </div>
        <p className="mt-1 text-[10px] text-slate-500">Updated 2 min ago ↻</p>
        <button className="mt-2 text-[10px] text-emerald-400 hover:text-emerald-300">View Data Sources</button>
      </div>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-[#060d18] text-white">
      {/* Sidebar with custom footer */}
      <div className="flex w-[220px] shrink-0 flex-col border-r border-white/5 bg-[#0c1628]">
        <AppSidebar currentPath="/matchups" footer={sidebarFooter} />
      </div>

      {/* Batter detail panel */}
      {selectedBatter && (
        <div className="fixed inset-y-0 right-0 z-50 w-80 overflow-y-auto border-l border-white/10 bg-[#0b1522] p-5 shadow-2xl">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-semibold text-white">Player Detail</h3>
            <button onClick={() => setSelectedBatter(null)} className="text-xl leading-none text-slate-400 hover:text-white">&times;</button>
          </div>
          <div className="flex items-center gap-3 rounded-xl bg-white/5 p-3">
            <PlayerAvatar playerName={selectedBatter.name} size={44} className="ring-1 ring-white/10" />
            <div>
              <p className="font-bold text-white">{selectedBatter.name}</p>
              <p className="text-xs text-slate-400">{selectedBatter.position} &bull; Bats {selectedBatter.hand} &bull; #{selectedBatter.order}</p>
              {selectedBatter.paPro && <p className="mt-0.5 text-xs font-semibold text-emerald-400">{selectedBatter.paPro} Proj PA</p>}
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-1.5 text-xs">
            {[["AVG", selectedBatter.avg], ["OBP", selectedBatter.obp], ["SLG", selectedBatter.slg], ["OPS", selectedBatter.ops]].map(([l, v]) => (
              <div key={l} className="rounded-lg bg-white/5 p-2 text-center">
                <p className="text-[8px] text-slate-600">{l}</p>
                <p className="font-semibold text-white">{v}</p>
              </div>
            ))}
          </div>
          {selectedBatter.vsHandedWoba && (
            <div className="mt-3 rounded-xl bg-emerald-500/10 p-3 text-xs">
              <p className="text-[9px] font-semibold uppercase tracking-wider text-emerald-500">vs Opposing Pitcher Hand</p>
              <p className="mt-1 font-bold text-emerald-400">{selectedBatter.vsHandedWoba} wOBA</p>
            </div>
          )}
          <div className="mt-4 space-y-2">
            <Link href="/research" className="flex items-center justify-between rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-400 hover:bg-emerald-500/20">
              Research Player <span>&rarr;</span>
            </Link>
            <Link href="/research" className="flex items-center justify-between rounded-xl border border-white/8 bg-white/5 px-4 py-2.5 text-sm text-slate-300 hover:text-white">
              Research Props <span>&rarr;</span>
            </Link>
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top nav */}
        <header className="flex shrink-0 items-center gap-3 border-b border-white/5 bg-[#0b1522] px-4 py-2.5">
          <label className="flex max-w-sm flex-1 items-center gap-2 rounded-xl border border-white/8 bg-white/5 px-3 py-1.5 text-sm text-slate-400">
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-600" placeholder="Search players, teams, props..." />
            <kbd className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-600">K</kbd>
          </label>
          <div className="ml-auto flex items-center gap-2">
            <button className="flex items-center gap-1.5 rounded-xl border border-white/8 bg-white/5 px-3 py-1.5 text-sm font-medium text-white">
              <TeamLogo teamId={119} abbreviation="MLB" size={16} />
              MLB <span className="text-slate-500">v</span>
            </button>
            <button className="flex items-center gap-1.5 rounded-xl border border-white/8 bg-white/5 px-3 py-1.5 text-sm font-medium text-white">📅 Today, {todayLabel} <span className="text-slate-500">v</span></button>
            <button className="relative flex h-8 w-8 items-center justify-center rounded-full border border-white/8 bg-white/5 text-slate-300">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24"><path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
              <span className="absolute right-0 top-0 h-2 w-2 rounded-full bg-emerald-500" />
            </button>
            <button className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-400">LR</button>
          </div>
        </header>

        {/* Alert strip */}
        {!alertDismissed && (
          <div className="flex shrink-0 items-center justify-between border-b border-amber-500/20 bg-amber-500/8 px-5 py-1.5">
            <div className="flex items-center gap-4 text-[11px] text-amber-300">
              <span className="font-semibold">Updates:</span>
              <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Lineup confirmed</span>
              <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />Starting pitcher set</span>
              <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" />Weather updated 7 min ago</span>
            </div>
            <button onClick={() => setAlertDismissed(true)} className="text-sm text-slate-500 hover:text-white">&times;</button>
          </div>
        )}

        <main className="flex-1 overflow-y-auto">
          <div className="space-y-4 p-5 pb-10">

            {/* ── Matchup selector + controls ── */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link href="/matchups" className="flex items-center gap-1 text-sm text-slate-400 hover:text-white">
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" /></svg>
                  Matchups
                </Link>
                <div className="flex gap-2 overflow-x-auto">
                  {games.map((entry) => (
                    <button key={entry.id} onClick={() => selectGame(entry.id)}
                      className={`flex shrink-0 items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition ${selectedId === entry.id ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-white/8 bg-white/3 text-slate-400 hover:border-white/15 hover:text-white"}`}>
                      <TeamLogo teamId={entry.awayTeam.id} abbreviation={entry.awayTeam.abbreviation} size={16} />
                      {entry.awayTeam.name}
                      <span className="text-slate-600">@</span>
                      <TeamLogo teamId={entry.homeTeam.id} abbreviation={entry.homeTeam.abbreviation} size={16} />
                      {entry.homeTeam.name}
                      <span className="text-[10px] text-slate-600">{new Date(entry.gameTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold text-emerald-400">LIVE MLB DATA</span>
                <span className="text-[10px] text-slate-500">{selectedGame.status}</span>
                <div className="flex rounded-xl border border-white/8 bg-white/4 p-0.5">
                  <button onClick={() => setIsAdvanced(false)} className={`rounded-lg px-3 py-1 text-xs font-medium transition ${!isAdvanced ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"}`}>Beginner</button>
                  <button onClick={() => setIsAdvanced(true)} className={`rounded-lg px-3 py-1 text-xs font-medium transition ${isAdvanced ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"}`}>Advanced</button>
                </div>
              </div>
            </div>

            {/* ── Game Header ── */}
            <div className="overflow-hidden rounded-2xl border border-white/6 bg-white/3">
              <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center">
                <div className="flex items-center gap-4">
                  <TeamLogo teamId={game.awayTeamId} abbreviation={game.awayLogo} teamName={game.awayTeam} size={64} />
                  <div>
                    <p className="text-[10px] text-slate-500">{game.awayDivision ?? "Away"}</p>
                    <h2 className="text-2xl font-extrabold text-white">{game.awayTeam}</h2>
                    <p className="text-sm text-slate-400">{game.awayRecord}</p>
                  </div>
                </div>
                <div className="flex flex-1 flex-col items-center gap-1.5 text-center">
                  <p className="text-sm font-semibold text-white">{game.time}</p>
                  <p className="text-xs text-slate-400">{game.stadium}</p>
                  <p className="text-xs text-slate-500">{selectedGame.status}</p>
                  <p className="text-xs text-slate-500">Weather unavailable</p>
                  <div className="mt-1 flex gap-2">
                    <button className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-400">⭐ Follow</button>
                    <button className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-slate-300">Share</button>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <TeamLogo teamId={game.homeTeamId} abbreviation={game.homeLogo} teamName={game.homeTeam} size={64} />
                  <div>
                    <p className="text-[10px] text-slate-500">{game.homeDivision ?? "Home"}</p>
                    <h2 className="text-2xl font-extrabold text-white">{game.homeTeam}</h2>
                    <p className="text-sm text-slate-400">{game.homeRecord}</p>
                  </div>
                </div>
              </div>

              {/* Tab navigation */}
              <div className="flex border-t border-white/5 overflow-x-auto">
                {TABS.map((tab) => (
                  <button key={tab} onClick={() => setActiveTab(tab)}
                    className={`flex items-center gap-1.5 shrink-0 px-4 py-2.5 text-sm font-medium transition border-b-2 ${activeTab === tab ? "border-emerald-500 text-emerald-400" : "border-transparent text-slate-500 hover:text-white"}`}>
                    {tab === "Matchup" && <span>⚾</span>}
                    {tab === "Lineups" && <span>👥</span>}
                    {tab === "Props" && <span>📊</span>}
                    {tab === "Odds" && <span>📈</span>}
                    {tab === "Trends" && <span>📉</span>}
                    {tab === "Insights" && <span>💡</span>}
                    {tab === "Alerts" && <span>🔔</span>}
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            {/* ── MATCHUP TAB content ── */}
            {activeTab === "Matchup" && (
              <>
                {/* Starting Pitcher Comparison — main visual focus */}
                <div className="overflow-hidden rounded-2xl border border-white/6 bg-white/3">
                  <div className="flex items-center justify-between border-b border-white/5 px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <span className="text-amber-400">🏆</span>
                      <h3 className="font-semibold text-white">Starting Pitcher Comparison</h3>
                    </div>
                    <div className="flex rounded-xl border border-white/8 bg-white/4 p-0.5">
                      <button onClick={() => setIsAdvanced(false)} className={`rounded-lg px-3 py-1 text-xs font-medium transition ${!isAdvanced ? "bg-white/10 text-white" : "text-slate-500"}`}>Beginner</button>
                      <button onClick={() => setIsAdvanced(true)} className={`rounded-lg px-3 py-1 text-xs font-medium transition ${isAdvanced ? "bg-white/10 text-white" : "text-slate-500"}`}>Advanced</button>
                    </div>
                  </div>

                  {/* Away pitcher */}
                  <div className="border-b border-white/5 p-5">
                    <div className="grid gap-5 md:grid-cols-[auto_1fr_auto]">
                      {/* Photo + header */}
                      <div className="flex gap-4">
                        <div className="relative">
                          <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-red-900/50 to-slate-800 ring-2 ring-red-500/20">
                            <PlayerAvatar playerName={awayPitcher.name} initials={awayPitcher.photo} playerId={awayPitcher.mlbPlayerId} size={88} />
                          </div>
                          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-slate-800 border border-white/10 px-2 py-0.5 text-[9px] font-bold text-white">{awayPitcher.hand}</span>
                        </div>
                        <div>
                          <p className="text-xl font-extrabold text-white">{awayPitcher.name}</p>
                          <p className="text-xs text-slate-400">#35 &bull; Starting Pitcher</p>
                          <div className="mt-2 flex flex-wrap gap-3 text-sm">
                            <div className="text-center">
                              <p className="font-bold text-white">{awayPitcher.record}</p>
                              <p className="text-[9px] text-slate-500">W-L</p>
                            </div>
                            <div className="text-center">
                              <p className="font-bold text-white">{awayPitcher.era}</p>
                              <p className="text-[9px] text-slate-500">ERA</p>
                            </div>
                            <div className="text-center">
                              <p className="font-bold text-white">{awayPitcher.totalK ?? "—"}</p>
                              <p className="text-[9px] text-slate-500">K</p>
                            </div>
                            <div className="text-center">
                              <p className="font-bold text-white">{awayPitcher.kPercent}</p>
                              <p className="text-[9px] text-slate-500">K%</p>
                            </div>
                            <div className="text-center">
                              <p className="font-bold text-white">{awayPitcher.bbPercent}</p>
                              <p className="text-[9px] text-slate-500">BB%</p>
                            </div>
                          </div>
                          {awayPitcher.vsOpponent2025 && (
                            <p className="mt-2 text-[11px] text-slate-400">2025 vs {game.homeTeam}: <span className="text-white">{awayPitcher.vsOpponent2025}</span></p>
                          )}
                        </div>
                      </div>

                      {/* Season overview bars: advanced sabermetrics are not provided by MLB Stats API */}
                      {isAdvanced && (
                        <div className="rounded-xl bg-white/4 p-4">
                          <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">2025 Season Overview</p>
                          <p className="text-xs text-slate-500">Advanced pitching metrics unavailable</p>
                        </div>
                      )}

                      {/* Projected tonight: no projection model connected */}
                      <div className="rounded-xl bg-white/4 p-4">
                        <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-amber-400/70">Projected (Tonight)</p>
                        <p className="text-xs text-slate-500">Projections unavailable</p>
                      </div>
                    </div>
                  </div>

                  {/* VS divider */}
                  <div className="flex items-center justify-center border-b border-white/5 py-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 text-sm font-bold text-slate-400">VS</div>
                  </div>

                  {/* Home pitcher */}
                  <div className="p-5">
                    <div className="grid gap-5 md:grid-cols-[auto_1fr_auto]">
                      <div className="flex gap-4">
                        <div className="relative">
                          <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-blue-900/50 to-slate-800 ring-2 ring-blue-500/20">
                            <PlayerAvatar playerName={homePitcher.name} initials={homePitcher.photo} playerId={homePitcher.mlbPlayerId} size={88} />
                          </div>
                          <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full bg-slate-800 border border-white/10 px-2 py-0.5 text-[9px] font-bold text-white">{homePitcher.hand}</span>
                        </div>
                        <div>
                          <p className="text-xl font-extrabold text-white">{homePitcher.name}</p>
                          <p className="text-xs text-slate-400">#55 &bull; Starting Pitcher</p>
                          <div className="mt-2 flex flex-wrap gap-3 text-sm">
                            {[["W-L", homePitcher.record], ["ERA", homePitcher.era], ["K", homePitcher.totalK ?? "—"], ["K%", homePitcher.kPercent], ["BB%", homePitcher.bbPercent]].map(([l, v]) => (
                              <div key={l} className="text-center">
                                <p className="font-bold text-white">{v}</p>
                                <p className="text-[9px] text-slate-500">{l}</p>
                              </div>
                            ))}
                          </div>
                          {homePitcher.vsOpponent2025 && (
                            <p className="mt-2 text-[11px] text-slate-400">2025 vs {game.awayTeam}: <span className="text-white">{homePitcher.vsOpponent2025}</span></p>
                          )}
                        </div>
                      </div>

                      {isAdvanced && (
                        <div className="rounded-xl bg-white/4 p-4">
                          <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">2025 Season Overview</p>
                          <p className="text-xs text-slate-500">Advanced pitching metrics unavailable</p>
                        </div>
                      )}

                      <div className="rounded-xl bg-white/4 p-4">
                        <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-amber-400/70">Projected (Tonight)</p>
                        <p className="text-xs text-slate-500">Projections unavailable</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── Key Edge | Matchup Summary | What Could Change: no prediction model connected ── */}
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="rounded-2xl border border-white/6 bg-white/3 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <span className="text-amber-400">🏆</span>
                      <h3 className="text-sm font-semibold text-white">Key Edge</h3>
                    </div>
                    <p className="text-xs text-slate-500">Model not connected</p>
                  </div>
                  <div className="rounded-2xl border border-white/6 bg-white/3 p-4">
                    <h3 className="mb-3 text-sm font-semibold text-white">Matchup Summary</h3>
                    <p className="text-xs text-slate-500">Model not connected</p>
                  </div>
                  <div className="rounded-2xl border border-white/6 bg-white/3 p-4">
                    <h3 className="mb-3 text-sm font-semibold text-white">What Could Change This?</h3>
                    <p className="text-xs text-slate-500">Model not connected</p>
                  </div>
                </div>

                {/* ── Recent Form | Splits ── */}
                <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
                  {/* Recent Form */}
                  <div className="overflow-hidden rounded-2xl border border-white/6 bg-white/3">
                    <div className="border-b border-white/5 px-4 py-3">
                      <h3 className="text-sm font-semibold text-white">Recent Form (Last 10 Games)</h3>
                    </div>
                    <div className="divide-y divide-white/5">
                      {[
                        { pitcher: awayPitcher, teamId: game.awayTeamId, logo: game.awayLogo },
                        { pitcher: homePitcher, teamId: game.homeTeamId, logo: game.homeLogo },
                      ].map(({ pitcher, teamId, logo }) => (
                        <div key={`${teamId}-${pitcher.name}`} className="p-4">
                          <div className="flex flex-wrap items-center gap-3">
                            <div className="flex items-center gap-2">
                              <TeamLogo teamId={teamId} abbreviation={logo} size={18} />
                              <div>
                                <p className="text-sm font-semibold text-white">{pitcher.name}</p>
                                {pitcher.recentFormRecord && (
                                  <p className="text-[10px] text-slate-400">{pitcher.recentFormRecord}, {pitcher.recentFormEra} ERA</p>
                                )}
                              </div>
                            </div>
                            {pitcher.recentFormRecord && (
                              <div className="flex flex-wrap gap-3 text-[11px] text-slate-400">
                                {[["IP", pitcher.recentFormIp], ["ERA", pitcher.recentFormEra], ["K/9", pitcher.recentFormK9], ["BB/9", pitcher.recentFormBb9], ["WHIP", pitcher.recentFormWhip]].map(([l, v]) => v && (
                                  <span key={l}>{l} {v}</span>
                                ))}
                              </div>
                            )}
                          </div>
                          {pitcher.recentFormGames && (
                            <div className="mt-2">
                              <GameResults results={pitcher.recentFormGames} />
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Splits (2025) */}
                  <div className="overflow-hidden rounded-2xl border border-white/6 bg-white/3">
                    <div className="border-b border-white/5 px-4 py-3 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-white">Splits (2025)</h3>
                      <div className="flex rounded-xl border border-white/8 p-0.5">
                        {(["vs LHB", "vs RHB", "Overall"] as SplitTab[]).map((tab) => (
                          <button key={tab} onClick={() => setSplitTab(tab)}
                            className={`rounded-lg px-2.5 py-1 text-[10px] font-medium transition ${splitTab === tab ? "bg-white/10 text-white" : "text-slate-500 hover:text-slate-300"}`}>
                            {tab}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-white/5 text-[9px] font-semibold uppercase tracking-wider text-slate-600">
                            <th className="px-4 py-2 text-left">Pitcher</th>
                            <th className="px-2 py-2">
                              <span className="flex items-center gap-0.5">wOBA <InfoTooltip text="Weighted On-Base Average — lower is better for pitchers." /></span>
                            </th>
                            <th className="px-2 py-2">OPS</th>
                            <th className="px-2 py-2">K%</th>
                            <th className="px-4 py-2">BB%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[
                            { pitcher: awayPitcher, teamId: game.awayTeamId, logo: game.awayLogo },
                            { pitcher: homePitcher, teamId: game.homeTeamId, logo: game.homeLogo },
                          ].map(({ pitcher, teamId, logo }) => {
                            const woba = splitTab === "vs LHB" ? pitcher.vsLhbWoba : splitTab === "vs RHB" ? pitcher.vsRhbWoba : awaySplit.woba;
                            const ops = splitTab === "vs LHB" ? pitcher.vsLhbOps : splitTab === "vs RHB" ? pitcher.vsRhbOps : pitcher.whip;
                            const k = splitTab === "vs LHB" ? pitcher.vsLhbKPercent : splitTab === "vs RHB" ? pitcher.vsRhbKPercent : pitcher.kPercent;
                            const bb = splitTab === "vs LHB" ? pitcher.vsLhbBbPercent : splitTab === "vs RHB" ? pitcher.vsRhbBbPercent : pitcher.bbPercent;
                            return (
                              <tr key={`${teamId}-${pitcher.name}`} className="border-b border-white/4 last:border-0 hover:bg-white/4">
                                <td className="px-4 py-3">
                                  <div className="flex items-center gap-2">
                                    <TeamLogo teamId={teamId} abbreviation={logo} size={16} />
                                    <span className="font-semibold text-white">{pitcher.name.split(" ")[1]} ({logo})</span>
                                  </div>
                                </td>
                                <td className="px-2 py-3 text-center font-semibold text-white">{woba ?? "—"}</td>
                                <td className="px-2 py-3 text-center text-slate-300">{ops ?? "—"}</td>
                                <td className="px-2 py-3 text-center text-emerald-400 font-semibold">{k ?? "—"}</td>
                                <td className="px-4 py-3 text-center text-slate-300">{bb ?? "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* ── Batter vs Starting Pitcher | Prop Matchup Scores ── */}
                <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
                  {/* BvP Table */}
                  <div className="overflow-hidden rounded-2xl border border-white/6 bg-white/3">
                    <div className="border-b border-white/5 px-4 py-3 flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-white">Batter vs Starting Pitcher (Career)</h3>
                      <InfoTooltip text="Career BvP stats. Small samples (<20 PA) use current-season splits as proxy." />
                    </div>
                    <div className="grid divide-y xl:divide-y-0 xl:divide-x divide-white/5 xl:grid-cols-2">
                      {/* Away batters vs home pitcher */}
                      <div className="overflow-x-auto">
                        <div className="px-4 py-2 border-b border-white/5">
                          <div className="flex items-center gap-1.5">
                            <TeamLogo teamId={game.awayTeamId} abbreviation={game.awayLogo} size={14} />
                            <p className="text-[11px] font-semibold text-white">{game.awayTeam} Hitters vs {homePitcher.name}</p>
                          </div>
                        </div>
                        <table className="w-full min-w-[400px] text-xs">
                          <thead>
                            <tr className="text-[9px] font-semibold uppercase tracking-wider text-slate-600">
                              <th className="px-4 py-2 text-left">Player</th>
                              <th className="px-2 py-2">PA</th>
                              <th className="px-2 py-2">H</th>
                              <th className="px-2 py-2">HR</th>
                              <th className="px-2 py-2">AVG</th>
                              <th className="px-2 py-2">OPS</th>
                              <th className="px-2 py-2">K%</th>
                              <th className="px-4 py-2">Notes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(bvpAway ?? []).map((row) => (
                              <tr key={`${row.player}-${row.hand}-${row.pa}`} className="border-t border-white/4 hover:bg-white/4">
                                <td className="px-4 py-2 font-semibold text-white whitespace-nowrap">
                                  {row.player} <span className="text-slate-500">({row.hand})</span>
                                </td>
                                <td className="px-2 py-2 text-center text-slate-300">{row.pa}</td>
                                <td className="px-2 py-2 text-center text-slate-300">{row.h}</td>
                                <td className="px-2 py-2 text-center text-slate-300">{row.hr}</td>
                                <td className="px-2 py-2 text-center font-semibold text-white">{row.avg}</td>
                                <td className="px-2 py-2 text-center text-slate-300">{row.ops}</td>
                                <td className="px-2 py-2 text-center text-slate-300">{row.k}</td>
                                <td className="px-4 py-2">
                                  <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-semibold ${row.notes === "Solid history" ? "bg-emerald-500/15 text-emerald-400" : "bg-slate-700/50 text-slate-400"}`}>{row.notes}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="border-t border-white/5 px-4 py-2 text-[9px] text-slate-600">
                          Sample size &lt; 20 PA &bull; <span className="text-slate-500">Using splits as proxy</span>
                        </div>
                      </div>

                      {/* Home batters vs away pitcher */}
                      <div className="overflow-x-auto">
                        <div className="px-4 py-2 border-b border-white/5">
                          <div className="flex items-center gap-1.5">
                            <TeamLogo teamId={game.homeTeamId} abbreviation={game.homeLogo} size={14} />
                            <p className="text-[11px] font-semibold text-white">{game.homeTeam} Hitters vs {awayPitcher.name}</p>
                          </div>
                        </div>
                        <table className="w-full min-w-[400px] text-xs">
                          <thead>
                            <tr className="text-[9px] font-semibold uppercase tracking-wider text-slate-600">
                              <th className="px-4 py-2 text-left">Player</th>
                              <th className="px-2 py-2">PA</th>
                              <th className="px-2 py-2">H</th>
                              <th className="px-2 py-2">HR</th>
                              <th className="px-2 py-2">AVG</th>
                              <th className="px-2 py-2">OPS</th>
                              <th className="px-2 py-2">K%</th>
                              <th className="px-4 py-2">Notes</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(bvpHome ?? []).map((row) => (
                              <tr key={`${row.player}-${row.hand}-${row.pa}`} className="border-t border-white/4 hover:bg-white/4">
                                <td className="px-4 py-2 font-semibold text-white whitespace-nowrap">
                                  {row.player} <span className="text-slate-500">({row.hand})</span>
                                </td>
                                <td className="px-2 py-2 text-center text-slate-300">{row.pa}</td>
                                <td className="px-2 py-2 text-center text-slate-300">{row.h}</td>
                                <td className="px-2 py-2 text-center text-slate-300">{row.hr}</td>
                                <td className="px-2 py-2 text-center font-semibold text-white">{row.avg}</td>
                                <td className="px-2 py-2 text-center text-slate-300">{row.ops}</td>
                                <td className="px-2 py-2 text-center text-slate-300">{row.k}</td>
                                <td className="px-4 py-2">
                                  <span className={`rounded-full px-1.5 py-0.5 text-[8px] font-semibold ${row.notes === "Solid history" ? "bg-emerald-500/15 text-emerald-400" : "bg-slate-700/50 text-slate-400"}`}>{row.notes}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="border-t border-white/5 px-4 py-2 text-[9px] text-slate-600">
                          Sample size &lt; 20 PA &bull; <span className="text-slate-500">Using splits as proxy</span>
                        </div>
                      </div>
                    </div>
                    <div className="border-t border-white/5 px-4 py-2 text-[9px] text-slate-600">
                      Scores are based on available projections and matchup factors &bull; <Link href="/research" className="text-emerald-400 hover:text-emerald-300">View All Props &amp; Insights &rarr;</Link>
                    </div>
                  </div>

                  {/* Prop Matchup Scores */}
                  {propAngles && propAngles.length > 0 && (
                    <div className="overflow-hidden rounded-2xl border border-white/6 bg-white/3">
                      <div className="border-b border-white/5 px-4 py-3 flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-white">Prop Matchup Scores</h3>
                        <InfoTooltip text="Mock scores based on available matchup factors. Not a real predictive model." />
                      </div>
                      <div className="divide-y divide-white/5">
                        {propAngles.map((angle) => (
                          <div key={`${angle.player}-${angle.prop}-${angle.score}`} className="p-4">
                            <div className="flex items-start gap-3">
                              <PlayerAvatar playerId={playersToWatch?.find(p => p.player === angle.player)?.playerId} playerName={angle.player} size={36} />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-bold text-white">{angle.player}</p>
                                <p className="text-xs text-slate-400">{angle.prop}</p>
                                <ScoreGauge score={angle.score} />
                              </div>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5">
                              <div>
                                <p className="text-[9px] font-semibold uppercase text-slate-600 mb-1">Factors</p>
                                {angle.positives.map((pos) => (
                                  <p key={pos} className="text-[10px] text-emerald-400">&bull; {pos}</p>
                                ))}
                              </div>
                              <div>
                                <p className="text-[9px] font-semibold uppercase text-slate-600 mb-1">Risk</p>
                                {angle.risks.map((risk) => (
                                  <p key={risk} className="text-[10px] text-rose-400/80">&bull; {risk}</p>
                                ))}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="border-t border-white/5 px-4 py-2">
                        <Link href="/research" className="text-[10px] text-emerald-400 hover:text-emerald-300">View All Props &amp; Insights &rarr;</Link>
                      </div>
                    </div>
                  )}
                </div>

                {/* ── Projected Batting Orders ── */}
                <div className="grid gap-4 xl:grid-cols-2">
                  {[
                    { team: game.awayTeam, teamId: game.awayTeamId, logo: game.awayLogo, lineup: awayLineup, split: awaySplit, status: "CONFIRMED" },
                    { team: game.homeTeam, teamId: game.homeTeamId, logo: game.homeLogo, lineup: homeLineup, split: homeSplit, status: "PROJECTED" },
                  ].map(({ team, teamId, logo, lineup, split, status }) => (
                    <div key={team} className="overflow-hidden rounded-2xl border border-white/6 bg-white/3">
                      <div className="flex items-center gap-2 border-b border-white/5 px-4 py-3">
                        <TeamLogo teamId={teamId} abbreviation={logo} size={20} />
                        <h3 className="font-semibold text-white">{team} Batting Order</h3>
                        <span className="ml-auto rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-400">
                          Unavailable
                        </span>
                      </div>
                      {lineup.length === 0 ? (
                        <p className="px-4 py-4 text-xs text-slate-500">Projected lineup unavailable</p>
                      ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[440px] text-xs">
                          <thead>
                            <tr className="border-b border-white/5 text-[9px] font-semibold uppercase tracking-wider text-slate-600">
                              <th className="px-3 py-2 text-left">#</th>
                              <th className="px-2 py-2 text-left">Player</th>
                              <th className="px-2 py-2">B</th>
                              <th className="px-2 py-2">Pos</th>
                              <th className="px-2 py-2">PA*</th>
                              <th className="px-2 py-2">AVG</th>
                              {isAdvanced && <th className="px-2 py-2">OPS</th>}
                              <th className="px-2 py-2">vs {split.vs}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lineup.map((b) => (
                              <tr key={b.id} onClick={() => setSelectedBatter(b)} className="cursor-pointer border-b border-white/4 last:border-0 transition hover:bg-white/6">
                                <td className="px-3 py-2 font-semibold text-slate-500">{b.order}</td>
                                <td className="px-2 py-2 font-semibold text-white">{b.name}</td>
                                <td className="px-2 py-2 text-center text-slate-400">{b.hand}</td>
                                <td className="px-2 py-2 text-center text-slate-400">{b.position}</td>
                                <td className="px-2 py-2 text-center font-semibold text-amber-300">{b.paPro ?? "—"}</td>
                                <td className="px-2 py-2 text-center text-slate-300">{b.avg}</td>
                                {isAdvanced && <td className="px-2 py-2 text-center text-slate-300">{b.wOps ?? b.ops}</td>}
                                <td className={`px-2 py-2 text-center font-semibold ${b.strong ? "text-emerald-400" : "text-slate-300"}`}>{b.vsHandedWoba ?? "—"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      )}
                      <div className="border-t border-white/5 px-4 py-2 text-[9px] text-slate-500">
                        Team wOBA vs {split.vs}: {split.woba} &bull; wRC+: {split.wrcPlus}
                      </div>
                    </div>
                  ))}
                </div>

                {/* ── 4-column: H2H | Recent Form | Park Factors | Weather ── */}
                <div className="grid gap-4 xl:grid-cols-4">
                  <div className="rounded-2xl border border-white/6 bg-white/3 p-4">
                    <h3 className="mb-3 text-sm font-semibold text-white">Head-to-Head</h3>
                    <p className="text-xs text-slate-500">Head-to-head data unavailable</p>
                  </div>
                  <div className="rounded-2xl border border-white/6 bg-white/3 p-4">
                    <h3 className="mb-3 text-sm font-semibold text-white">Recent Team Form</h3>
                    {[
                      { team: game.awayTeam, form: awayForm, games: awayRecentGames, teamId: game.awayTeamId, logo: game.awayLogo },
                      { team: game.homeTeam, form: homeForm, games: homeRecentGames, teamId: game.homeTeamId, logo: game.homeLogo },
                    ].map(({ team, form, games, logo, teamId }) => (
                      <div key={team} className="mb-3 last:mb-0">
                        <div className="mb-1 flex items-center gap-1.5">
                          <TeamLogo teamId={teamId} abbreviation={logo} size={14} />
                          <span className="text-xs text-white">{team}</span>
                          <span className="ml-auto text-xs font-semibold text-white">{form.last10}</span>
                        </div>
                        {games && <GameResults results={games} />}
                      </div>
                    ))}
                  </div>
                  <div className="rounded-2xl border border-white/6 bg-white/3 p-4">
                    <h3 className="mb-3 text-sm font-semibold text-white">Park Factors</h3>
                    <p className="text-xs text-slate-500">Park factors unavailable</p>
                  </div>
                  <div className="rounded-2xl border border-white/6 bg-white/3 p-4">
                    <h3 className="mb-3 text-sm font-semibold text-white">Weather Impact</h3>
                    <p className="text-xs text-slate-500">Weather unavailable</p>
                  </div>
                </div>

                {/* ── Last 5 Meetings + Key Splits ── */}
                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="overflow-hidden rounded-2xl border border-white/6 bg-white/3">
                    <div className="border-b border-white/5 px-4 py-3"><h3 className="font-semibold text-white">Last 5 Meetings</h3></div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-white/5 text-[9px] font-semibold uppercase tracking-wider text-slate-600">
                          <th className="px-4 py-2 text-left">Date</th>
                          <th className="px-2 py-2 text-left">Score</th>
                          <th className="px-2 py-2 text-left">Winner</th>
                          <th className="px-2 py-2 text-left">W Pitcher</th>
                          <th className="px-2 py-2 text-left">L Pitcher</th>
                        </tr>
                      </thead>
                      <tbody>
                        {headToHead.map((g) => (
                          <tr key={g.date} className="border-b border-white/4 last:border-0 hover:bg-white/4">
                            <td className="px-4 py-2 text-slate-400">{g.date}</td>
                            <td className="px-2 py-2 font-semibold text-white">{g.score}</td>
                            <td className={`px-2 py-2 font-semibold ${g.winner === game.awayTeam ? "text-red-400" : "text-blue-400"}`}>{g.winner}</td>
                            <td className="px-2 py-2 text-slate-400">{g.awayPitcherNote?.split(" (")[0] ?? "—"}</td>
                            <td className="px-2 py-2 text-slate-400">{g.homePitcherNote?.split(" (")[0] ?? "—"}</td>
                          </tr>
                        ))}
                        {headToHead.length === 0 && (
                          <tr><td colSpan={5} className="px-4 py-3 text-xs text-slate-500">Head-to-head data unavailable</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div className="overflow-hidden rounded-2xl border border-white/6 bg-white/3">
                    <div className="border-b border-white/5 px-4 py-3"><h3 className="font-semibold text-white">Key Splits (2025)</h3></div>
                    <div className="grid grid-cols-2 divide-x divide-white/5 p-4">
                      {[
                        { team: game.awayTeam, teamId: game.awayTeamId, logo: game.awayLogo, split: awaySplit },
                        { team: game.homeTeam, teamId: game.homeTeamId, logo: game.homeLogo, split: homeSplit },
                      ].map(({ team, teamId, logo, split }) => (
                        <div key={team} className="px-3 first:pl-0 last:pr-0">
                          <div className="mb-2 flex items-center gap-1.5">
                            <TeamLogo teamId={teamId} abbreviation={logo} size={14} />
                            <span className="text-xs font-semibold text-white">{team} vs {split.vs}</span>
                          </div>
                          {[["wOBA", split.woba], ["OPS", split.ops], ["ISO", split.iso], ["K%", split.kPercent], ["BB%", split.bbPercent]].map(([l, v]) => (
                            <div key={l} className="flex items-center justify-between py-1 text-xs">
                              <span className="text-slate-500">{l}</span>
                              <span className="font-semibold text-white">{v}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* ── Research Tools ── */}
                <section>
                  <h2 className="mb-3 font-semibold text-white">Research Tools &amp; Insights</h2>
                  <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-8">
                    {RESEARCH_TOOLS.map((tool) => (
                      <div key={tool.title} className="flex flex-col rounded-2xl border border-white/6 bg-white/3 p-3 transition hover:border-white/12 hover:bg-white/5">
                        <span className="text-xl">{tool.icon}</span>
                        <p className="mt-2 text-sm font-semibold text-emerald-400">{tool.title}</p>
                        <p className="mt-1 flex-1 text-[10px] leading-relaxed text-slate-400">{tool.desc}</p>
                        <Link href={tool.href} className="mt-2 text-[11px] font-semibold text-slate-300 hover:text-emerald-400">{tool.cta} &rarr;</Link>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Relevant props */}
                {relevantProps.length > 0 && (
                  <section className="rounded-2xl border border-white/6 bg-white/3 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="font-semibold text-white">Top Research Angles</h3>
                      <Link href="/research" className="text-sm text-emerald-400 hover:text-emerald-300">View All</Link>
                    </div>
                    <div className="space-y-2">
                      {relevantProps.map((prop) => {
                        const angle = propAngles?.find(a => a.player === prop.player);
                        const playerMeta = playersToWatch?.find((player) => player.player === prop.player);
                        const [propSide, ...propLabel] = prop.prop.split(' ');
                        return (
                          <div key={prop.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/3 px-3 py-2">
                            <div>
                              <p className="text-sm font-semibold text-white">{prop.player}</p>
                              <p className="text-xs text-slate-500">{prop.prop} &bull; Line {prop.line}</p>
                            </div>
                            <div className="flex items-center gap-3">
                              {angle && <span className="text-xs font-semibold text-emerald-400">{angle.score}/10</span>}
                              <span className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-xs font-semibold text-emerald-400">{prop.confidence}%</span>
                              <Link href={getResearchHref({ playerId: playerMeta?.playerId, opportunityId: prop.id })} className="text-xs text-emerald-400 hover:text-emerald-300">Research &rarr;</Link>
                              <AddPickButton id={prop.id} playerId={playerMeta?.playerId} playerName={prop.player} teamId={playerMeta?.teamId} teamName={playerMeta?.team ?? matchup.game.awayTeam} opponentName={matchup.game.homeTeam} gameId={matchup.game.id} gameTime={matchup.game.time} propType={propLabel.join(' ')} side={propSide.toLowerCase() as 'over' | 'under'} line={Number(prop.line)} odds={-110} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

              </>
            )}

            {/* ── Non-matchup tabs ── */}
            {activeTab === "Lineups" && <LineupTab matchup={matchup} isAdvanced={isAdvanced} setSelectedBatter={setSelectedBatter} />}
            {activeTab === "Props" && <PropsTab matchup={matchup} isAdvanced={isAdvanced} />}
            {activeTab === "Odds" && <OddsTab matchup={matchup} isAdvanced={isAdvanced} />}
            {activeTab === "Trends" && <TrendsTab matchup={matchup} isAdvanced={isAdvanced} />}
            {activeTab === "Insights" && <InsightsTab matchup={matchup} isAdvanced={isAdvanced} />}
            {activeTab === "Alerts" && <AlertsTab matchup={matchup} isAdvanced={isAdvanced} />}

            {/* Footer */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/5 pt-4 text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/20 text-[10px] font-bold text-emerald-400">LR</div>
                <span>Lisandro</span>
                <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-400">Pro Member</span>
              </div>
              <p>© 2025 DeepSide. All rights reserved.</p>
              <p>Built for serious research. Use responsibly.</p>
              <div className="flex gap-3">
                <Link href="#" className="hover:text-slate-400">Terms</Link>
                <Link href="#" className="hover:text-slate-400">Privacy</Link>
                <Link href="#" className="hover:text-slate-400">Support</Link>
              </div>
            </div>

            <NewsAlertsPanel context={['Yankees', 'Red Sox', 'Judge']} />

          </div>
        </main>
      </div>
    </div>
  );
}
