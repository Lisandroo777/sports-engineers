"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppSidebar } from "../../components/AppSidebar";
import { NewsUnavailablePanel } from "../../components/NewsUnavailablePanel";
import { AddPickButton } from "../../components/AddPickButton";
import { HitRateMiniBar } from "../../components/HitRateMiniBar";
import { InfoTooltip } from "../../components/InfoTooltip";
import { PlayerAvatar } from "../../components/PlayerAvatar";
import { NFLPlayerAvatar } from "../../components/NFLPlayerAvatar";
import { TeamLogo } from "../../components/TeamLogo";
import { getResearchHref } from "../../lib/researchHref";
import { resolveSlateDate, todaySlateDate, tomorrowSlateDate, presetForSlateDate } from "../../lib/dateModel";
import { type PropResearchItem } from "./mockData";
import type { MLBPlayer } from "../../lib/mlb/types";
import type { NFLPlayer } from "../../lib/nfl/types";
import type { FinderResult, FinderRunSummary } from "../../lib/finder/engine";
import { finderResultToListItem } from "../../lib/finder/toPropResearchItem";

// ─── constants ────────────────────────────────────────────────────────────────

const PRESETS = [
  { label: "High Confidence", key: "high-confidence" },
  { label: "Low Variance", key: "low-variance" },
  { label: "Pitcher Ks", key: "pitcher-ks" },
  { label: "Batter Hits", key: "batter-hits" },
  { label: "Total Bases", key: "total-bases" },
  { label: "Home Runs", key: "home-runs" },
  { label: "Overs", key: "overs" },
  { label: "Unders", key: "unders" },
];

const PAGE_SIZE = 8;

// ─── helpers ──────────────────────────────────────────────────────────────────

function hitRateColor(v: number) {
  if (v >= 70) return "text-emerald-400";
  if (v >= 50) return "text-amber-400";
  return "text-rose-400";
}

function hitRateBarColor(v: number) {
  if (v >= 70) return "bg-emerald-500";
  if (v >= 50) return "bg-amber-500";
  return "bg-rose-500";
}

function confidenceBadge(n: number): { text: string; cls: string } {
  if (n >= 80) return { text: "Strong", cls: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" };
  if (n >= 70) return { text: "Good", cls: "bg-teal-500/15 text-teal-400 border-teal-500/25" };
  if (n >= 60) return { text: "Average", cls: "bg-amber-500/15 text-amber-400 border-amber-500/25" };
  return { text: "Low", cls: "bg-rose-500/15 text-rose-400 border-rose-500/25" };
}

function HitRateMini({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="text-center">
      <p className={`text-xs font-semibold ${value == null ? "text-slate-600" : hitRateColor(value)}`}>{value == null ? "\u2014" : `${value}%`}</p>
      <div className="mt-0.5 h-1 w-10 overflow-hidden rounded-full bg-white/5">
        <div className={`h-full rounded-full ${value == null ? "" : hitRateBarColor(value)}`} style={{ width: Math.min(100, value ?? 0) + "%" }} />
      </div>
      <p className="mt-0.5 text-[8px] text-slate-600">{label}</p>
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function ResearchPage() {
  return (
    <Suspense fallback={null}>
      <ResearchPageContent />
    </Suspense>
  );
}

function ResearchPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  // Standard filters
  const [selectedSport, setSelectedSport] = useState(() => {
    const sportParam = searchParams.get('sport')?.toLowerCase();
    return sportParam === 'nfl' ? 'NFL' : 'MLB';
  });
  const [selectedDate, setSelectedDate] = useState(() => resolveSlateDate(searchParams.get('date')));
  const [playerFilter, setPlayerFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("All");
  const [propTypeFilter, setPropTypeFilter] = useState("All");
  const [oddsFilter, setOddsFilter] = useState("All");
  const [confidenceFilter, setConfidenceFilter] = useState("0");
  const [sortBy, setSortBy] = useState("confidence");
  // Advanced filters
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [homeAwayFilter, setHomeAwayFilter] = useState("All");
  const [l5Filter, setL5Filter] = useState("0");
  const [l10Filter, setL10Filter] = useState("0");
  const [l20Filter, setL20Filter] = useState("0");
  const [sampleFilter, setSampleFilter] = useState("0");
  // Preset + UI
  const [activePreset, setActivePreset] = useState<string | null>(null);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [showAll, setShowAll] = useState(false);
  // Selection + queue
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [queueOrder, setQueueOrder] = useState<string[]>([]);
  const [recentResearched, setRecentResearched] = useState<PropResearchItem[]>([]);
  // Live MLB opportunities (from the shared, credit-protected Finder cache)
  const [liveSummary, setLiveSummary] = useState<FinderRunSummary | null>(null);
  const [liveListLoading, setLiveListLoading] = useState(true);
  const [liveListError, setLiveListError] = useState(false);
  // Quick search
  const [qSearch, setQSearch] = useState("");
  const [livePlayers, setLivePlayers] = useState<MLBPlayer[]>([]);
  const [liveSearchLoading, setLiveSearchLoading] = useState(false);
  const [liveSearchError, setLiveSearchError] = useState(false);
  // Live NFL player search (kept fully separate from the MLB search path so results never mix)
  const [liveNFLPlayers, setLiveNFLPlayers] = useState<NFLPlayer[]>([]);
  const [liveNFLSearchLoading, setLiveNFLSearchLoading] = useState(false);
  const [liveNFLSearchError, setLiveNFLSearchError] = useState(false);
  const quickActionsRef = useRef<HTMLDivElement>(null);
  const comparePanelRef = useRef<HTMLDivElement>(null);

  // Keep the URL's ?sport=/?date= params in sync with the selectors so links/refreshes preserve the chosen slate.
  useEffect(() => {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    const nextSport = selectedSport === 'NFL' ? 'nfl' : 'mlb';
    if (params.get('sport') === nextSport && params.get('date') === selectedDate) return;
    params.set('sport', nextSport);
    params.set('date', selectedDate);
    router.replace(`/research?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSport, selectedDate]);

  useEffect(() => {
    const query = playerFilter.trim();
    if (selectedSport !== 'MLB' || query.length < 2) { setLivePlayers([]); return; }
    const timeoutId = window.setTimeout(() => {
      setLiveSearchLoading(true); setLiveSearchError(false);
      fetch(`/api/mlb/players/search?q=${encodeURIComponent(query)}`)
        .then(async (response) => { if (!response.ok) throw new Error('Search unavailable'); return response.json() as Promise<{ data: MLBPlayer[] }>; })
        .then((payload) => setLivePlayers(Array.from(new Map(payload.data.map((player) => [player.id, player])).values())))
        .catch(() => { setLivePlayers([]); setLiveSearchError(true); })
        .finally(() => setLiveSearchLoading(false));
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [playerFilter, selectedSport]);

  useEffect(() => {
    const query = playerFilter.trim();
    if (selectedSport !== 'NFL' || query.length < 2) { setLiveNFLPlayers([]); return; }
    const timeoutId = window.setTimeout(() => {
      setLiveNFLSearchLoading(true); setLiveNFLSearchError(false);
      fetch(`/api/nfl/players/search?q=${encodeURIComponent(query)}`)
        .then(async (response) => { if (!response.ok) throw new Error('Search unavailable'); return response.json() as Promise<{ data: NFLPlayer[] }>; })
        .then((payload) => setLiveNFLPlayers(Array.from(new Map(payload.data.map((player) => [player.id, player])).values())))
        .catch(() => { setLiveNFLPlayers([]); setLiveNFLSearchError(true); })
        .finally(() => setLiveNFLSearchLoading(false));
    }, 250);
    return () => window.clearTimeout(timeoutId);
  }, [playerFilter, selectedSport]);

  // Prefill from ?q= (e.g. Dashboard header search) once on mount.
  useEffect(() => {
    const q = searchParams.get('q');
    if (q) setPlayerFilter(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLiveListLoading(true);
    setLiveListError(false);
    fetch(`/api/finder/mlb/deep-search?date=${encodeURIComponent(selectedDate)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((payload: { data: FinderRunSummary } | null) => { if (!cancelled && payload) setLiveSummary(payload.data); })
      .catch(() => { if (!cancelled) setLiveListError(true); })
      .finally(() => { if (!cancelled) setLiveListLoading(false); });
    return () => { cancelled = true; };
  }, [selectedDate]);

  // ── preset application ────────────────────────────────────────────────────
  function applyPreset(key: string) {
    setActivePreset(key === activePreset ? null : key);
    setPropTypeFilter("All"); setOddsFilter("All"); setConfidenceFilter("0");
    if (key === "high-confidence") setConfidenceFilter("75");
    if (key === "pitcher-ks") setPropTypeFilter("Strikeouts");
    if (key === "batter-hits") setPropTypeFilter("Hits");
    if (key === "total-bases") setPropTypeFilter("Total Bases");
    if (key === "home-runs") setPropTypeFilter("Home Runs");
    if (key === "overs") setOddsFilter("Over");
    if (key === "unders") setOddsFilter("Under");
  }

  // ── active filter count ───────────────────────────────────────────────────
  const advancedCount = [
    confidenceFilter !== "0",
    l5Filter !== "0",
    l10Filter !== "0",
    sampleFilter !== "0",
    homeAwayFilter !== "All",
  ].filter(Boolean).length;

  // ── active filter tags ────────────────────────────────────────────────────
  const activeTags: Array<{ label: string; clear: () => void }> = [
    ...(confidenceFilter !== "0" ? [{ label: `Min Confidence: ${confidenceFilter}%+`, clear: () => setConfidenceFilter("0") }] : []),
    ...(l5Filter !== "0" ? [{ label: `L5 Hit Rate: ${l5Filter}%+`, clear: () => setL5Filter("0") }] : []),
    ...(l10Filter !== "0" ? [{ label: `L10 Hit Rate: ${l10Filter}%+`, clear: () => setL10Filter("0") }] : []),
    ...(sampleFilter !== "0" ? [{ label: `Min Sample: ${sampleFilter}+`, clear: () => setSampleFilter("0") }] : []),
    ...(homeAwayFilter !== "All" ? [{ label: `Home/Away: ${homeAwayFilter}`, clear: () => setHomeAwayFilter("All") }] : []),
    ...(propTypeFilter !== "All" ? [{ label: `Prop: ${propTypeFilter}`, clear: () => setPropTypeFilter("All") }] : []),
    ...(teamFilter !== "All" ? [{ label: `Team: ${teamFilter}`, clear: () => setTeamFilter("All") }] : []),
    ...(oddsFilter !== "All" ? [{ label: `Side: ${oddsFilter}`, clear: () => setOddsFilter("All") }] : []),
  ];

  function clearAllFilters() {
    setSelectedSport("MLB"); setPlayerFilter(""); setTeamFilter("All");
    setPropTypeFilter("All"); setOddsFilter("All"); setConfidenceFilter("0");
    setSortBy("confidence"); setHomeAwayFilter("All"); setL5Filter("0");
    setL10Filter("0"); setL20Filter("0"); setSampleFilter("0"); setActivePreset(null);
  }

  // Prop Dive is 100% real data now — only live MLB Finder opportunities populate the table.
  // NFL sportsbook props aren't connected yet, so NFL intentionally contributes zero rows here
  // rather than surfacing fabricated opportunities.
  const baseResearchData = useMemo(() => {
    return (liveSummary?.results ?? []).map(finderResultToListItem);
  }, [liveSummary]);

  // ── filtering ─────────────────────────────────────────────────────────────
  const filteredProps = useMemo(() => {
    const norm = playerFilter.trim().toLowerCase();
    const minConf = Number(confidenceFilter);
    const minL5 = Number(l5Filter);
    const minL10 = Number(l10Filter);
    const minL20 = Number(l20Filter);

    const filtered = baseResearchData.filter((p) => {
      if (p.sport !== selectedSport) return false;
      if (norm && !p.player.toLowerCase().includes(norm)) return false;
      if (teamFilter !== "All" && p.team !== teamFilter) return false;
      if (propTypeFilter !== "All" && p.propType !== propTypeFilter) return false;
      if (oddsFilter === "Over" && Number.parseFloat(p.overOdds) >= 0) return false;
      if (oddsFilter === "Under" && Number.parseFloat(p.underOdds) >= 0) return false;
      if (p.confidence < minConf) return false;
      if (minL5 > 0 && p.hitRates.last5 < minL5) return false;
      if (minL10 > 0 && p.hitRates.last10 < minL10) return false;
      if (minL20 > 0 && p.hitRates.last20 < minL20) return false;
      if (homeAwayFilter !== "All" && p.homeAway !== homeAwayFilter) return false;
      return true;
    });

    return [...filtered].sort((a, b) => {
      if (sortBy === "projectedValue") return b.projectedValue - a.projectedValue;
      if (sortBy === "last5") return b.hitRates.last5 - a.hitRates.last5;
      if (sortBy === "last10") return b.hitRates.last10 - a.hitRates.last10;
      return b.confidence - a.confidence;
    });
  }, [baseResearchData, confidenceFilter, homeAwayFilter, l10Filter, l20Filter, l5Filter, oddsFilter, playerFilter, propTypeFilter, selectedSport, sortBy, teamFilter]);

  const teamOptions = Array.from(new Set(baseResearchData.map((p) => p.team)));
  const propTypeOptions = Array.from(new Set(baseResearchData.map((p) => p.propType)));
  const visibleProps = showAll ? filteredProps : filteredProps.slice(0, PAGE_SIZE);

  // ── selection ─────────────────────────────────────────────────────────────
  function toggleSelect(prop: PropResearchItem) {
    const id = prop.id;
    const isSelected = selectedIds.has(id);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (isSelected) next.delete(id); else next.add(id);
      return next;
    });
    setQueueOrder((q) => (isSelected ? q.filter((x) => x !== id) : [...q, id]));
  }

  function selectAll() {
    const ids = visibleProps.map((p) => p.id);
    setSelectedIds(new Set(ids));
    setQueueOrder(ids);
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setQueueOrder([]);
  }

  function moveQueueUp(id: string) {
    setQueueOrder((q) => { const i = q.indexOf(id); if (i <= 0) return q; const r = [...q]; [r[i-1], r[i]] = [r[i], r[i-1]]; return r; });
  }
  function moveQueueDown(id: string) {
    setQueueOrder((q) => { const i = q.indexOf(id); if (i >= q.length-1) return q; const r = [...q]; [r[i], r[i+1]] = [r[i+1], r[i]]; return r; });
  }

  const queueItems = queueOrder.map((id) => baseResearchData.find((p) => p.id === id)).filter(Boolean) as PropResearchItem[];
  const compareItems = queueItems.slice(0, 3);

  function handleResearch(prop: PropResearchItem) {
    setRecentResearched((prev) => {
      const next = [prop, ...prev.filter((p) => p.id !== prop.id)].slice(0, 4);
      return next;
    });
  }

  // ── sidebar footer ────────────────────────────────────────────────────────
  // Real, sport/date-aware "Players to Watch" drawn from the live Finder slate — no more static mock list.
  const watchPlayers = useMemo(() => {
    if (selectedSport !== 'MLB') return [];
    const seen = new Set<number>();
    const picks: Array<{ id: string; playerId: number; name: string; team: string; teamId?: number }> = [];
    for (const result of liveSummary?.results ?? []) {
      if (!result.playerId || seen.has(result.playerId)) continue;
      seen.add(result.playerId);
      picks.push({ id: result.id, playerId: result.playerId, name: result.player, team: result.teamName ?? 'Data unavailable', teamId: result.teamId ?? undefined });
      if (picks.length >= 5) break;
    }
    return picks;
  }, [liveSummary, selectedSport]);

  const sidebarFooter = (
    <div className="mt-4 border-t border-white/5 pt-4">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-white">
        <span>👥</span> Players to Watch
      </p>
      {selectedSport !== 'MLB' ? (
        <p className="text-[10px] text-slate-500">Search for an NFL player above to start researching.</p>
      ) : liveListLoading ? (
        <p className="text-[10px] text-slate-500">Loading today&rsquo;s slate…</p>
      ) : watchPlayers.length === 0 ? (
        <p className="text-[10px] text-slate-500">No live opportunities available right now.</p>
      ) : (
        <div className="space-y-2">
          {watchPlayers.map((player) => (
            <Link key={player.id} href={getResearchHref({ playerId: player.playerId, date: selectedDate })} className="flex items-center gap-2.5 rounded-xl border border-white/5 bg-white/3 px-2.5 py-2 transition hover:bg-white/7">
              <div className="relative shrink-0">
                <PlayerAvatar playerId={player.playerId} playerName={player.name} size={30} />
                {player.teamId != null && <TeamLogo teamId={player.teamId} abbreviation={player.team.slice(0, 3)} size={12} className="absolute -bottom-0.5 -right-0.5 ring-1 ring-[#060d18]" />}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-white">{player.name}</p>
                <p className="text-[9px] text-slate-500">{player.team}</p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-screen bg-[#060d18] text-white">
      <AppSidebar currentPath="/research" footer={sidebarFooter} />

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top nav */}
        <header className="flex shrink-0 items-center gap-3 border-b border-white/5 bg-[#0b1522] px-4 py-2.5">
          <label className="flex max-w-sm flex-1 items-center gap-2 rounded-xl border border-white/8 bg-white/5 px-3 py-1.5 text-sm text-slate-400">
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input className="flex-1 bg-transparent text-sm outline-none placeholder:text-slate-600" placeholder="Search players, teams, props..." value={playerFilter} onChange={(e) => setPlayerFilter(e.target.value)} />
            <kbd className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-600">K</kbd>
          </label>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl border border-white/8 bg-white/5 p-1 text-sm font-medium">
              <button
                onClick={() => setSelectedSport('MLB')}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition ${selectedSport === 'MLB' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400 hover:text-white'}`}
              >
                <TeamLogo teamId={119} abbreviation="MLB" size={16} /> MLB
              </button>
              <button
                onClick={() => setSelectedSport('NFL')}
                className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 transition ${selectedSport === 'NFL' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400 hover:text-white'}`}
              >
                NFL
              </button>
            </div>
            <div className="flex items-center gap-1 rounded-xl border border-white/8 bg-white/5 p-1 text-sm font-medium">
              <button
                onClick={() => setSelectedDate(todaySlateDate())}
                className={`rounded-lg px-2.5 py-1 transition ${presetForSlateDate(selectedDate) === 'today' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400 hover:text-white'}`}
              >
                Today
              </button>
              <button
                onClick={() => setSelectedDate(tomorrowSlateDate())}
                className={`rounded-lg px-2.5 py-1 transition ${presetForSlateDate(selectedDate) === 'tomorrow' ? 'bg-emerald-500/20 text-emerald-300' : 'text-slate-400 hover:text-white'}`}
              >
                Tomorrow
              </button>
            </div>
            <button disabled title="Notifications are not connected yet" className="relative flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-full border border-white/8 bg-white/5 text-slate-300 opacity-50">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24"><path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" /></svg>
            </button>
            <Link href="/account" className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/20 text-xs font-bold text-emerald-400 transition hover:bg-emerald-500/30">LR</Link>
          </div>
        </header>

        {/* Two-column main area */}
        <div className="flex flex-col gap-0 xl:flex-row xl:items-start">

          {/* ── Left: filters + results ── */}
          <main className="min-w-0 flex-1 p-4 pb-10 lg:p-5">
            {/* Page header */}
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-bold text-white">Prop Dive</h1>
                <p className="mt-1 text-sm text-slate-400">Find high edge prop opportunities with powerful filters and real data.</p>
              </div>
              <div className="flex items-center gap-2">
                <Link href="/account" className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-sm font-bold text-slate-950 hover:bg-emerald-400">
                  ⭐ View Plan
                </Link>
                <div className="relative" ref={quickActionsRef}>
                  <button onClick={() => setShowQuickActions((v) => !v)} className="flex items-center gap-1.5 rounded-xl border border-white/8 bg-white/5 px-3 py-1.5 text-sm text-slate-300 hover:text-white">
                    Quick Actions <span className="text-slate-500">v</span>
                  </button>
                  {showQuickActions && (
                    <div className="absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-xl border border-white/10 bg-[#0c1628] shadow-2xl">
                      <button
                        disabled={compareItems.length < 2}
                        title={compareItems.length < 2 ? 'Select at least 2 props to compare' : undefined}
                        onClick={() => { setShowQuickActions(false); comparePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                        className="block w-full px-4 py-2.5 text-left text-xs text-slate-300 transition hover:bg-white/8 hover:text-white disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-transparent"
                      >Compare All Selected</button>
                      <button
                        disabled={selectedIds.size === 0}
                        onClick={() => { setShowQuickActions(false); clearSelection(); }}
                        className="block w-full px-4 py-2.5 text-left text-xs text-slate-300 transition hover:bg-white/8 hover:text-white disabled:cursor-not-allowed disabled:text-slate-600 disabled:hover:bg-transparent"
                      >Clear Selections</button>
                      {["Export to CSV", "Save as Watchlist", "Set up Alerts"].map((action) => (
                        <button key={action} disabled title="Coming soon" className="block w-full cursor-not-allowed px-4 py-2.5 text-left text-xs text-slate-600">{action}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Preset tabs */}
            <div className="mb-4 flex flex-wrap gap-1.5">
              {PRESETS.map((p) => (
                <button key={p.key} onClick={() => applyPreset(p.key)}
                  disabled={selectedSport === 'NFL'}
                  title={selectedSport === 'NFL' ? "NFL sportsbook props aren't connected yet" : undefined}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${activePreset === p.key ? "bg-emerald-500 text-slate-950" : "border border-white/8 bg-white/3 text-slate-400 hover:border-white/15 hover:text-white"}`}>
                  {p.label}
                </button>
              ))}
            </div>

            {/* Standard filter row */}
            <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {/* Player */}
              <label className="relative flex min-w-0 flex-col rounded-lg border border-white/8 bg-white/3 px-2.5 py-2 focus-within:border-emerald-500/40">
                <div className="flex items-center gap-1"><svg className="h-3 w-3 text-slate-500" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" /></svg><span className="text-[10px] text-slate-500">Player</span></div>
                <input className="mt-0.5 bg-transparent text-sm text-white outline-none placeholder:text-slate-600" placeholder="Any Player" value={playerFilter} onChange={(e) => setPlayerFilter(e.target.value)} />
              </label>
              {/* Team */}
              <div title={selectedSport === 'NFL' ? "NFL sportsbook props aren't connected yet" : undefined} className={`relative flex min-w-0 flex-col rounded-lg border border-white/8 bg-white/3 px-2.5 py-2 hover:border-white/15 ${selectedSport === 'NFL' ? 'cursor-not-allowed opacity-40' : ''}`}>
                <div className="flex items-center gap-1"><svg className="h-3 w-3 text-slate-500" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg><span className="text-[10px] text-slate-500">Team</span></div>
                <div className="flex items-center justify-between"><span className="text-sm text-white">{teamFilter === "All" ? "Any Team" : teamFilter}</span><span className="text-[10px] text-slate-600">&#x25be;</span></div>
                <select disabled={selectedSport === 'NFL'} className="absolute inset-0 cursor-pointer rounded-xl opacity-0 disabled:cursor-not-allowed" value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
                  <option value="All">Any team</option>
                  {teamOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              {/* Prop Type */}
              <div title={selectedSport === 'NFL' ? "NFL sportsbook props aren't connected yet" : undefined} className={`relative flex min-w-0 flex-col rounded-lg border border-white/8 bg-white/3 px-2.5 py-2 hover:border-white/15 ${selectedSport === 'NFL' ? 'cursor-not-allowed opacity-40' : ''}`}>
                <div className="flex items-center gap-1"><svg className="h-3 w-3 text-slate-500" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3"/></svg><span className="text-[10px] text-slate-500">Prop Type</span></div>
                <div className="flex items-center justify-between"><span className="text-sm text-white">{propTypeFilter === "All" ? "Any Prop" : propTypeFilter}</span><span className="text-[10px] text-slate-600">&#x25be;</span></div>
                <select disabled={selectedSport === 'NFL'} className="absolute inset-0 cursor-pointer rounded-xl opacity-0 disabled:cursor-not-allowed" value={propTypeFilter} onChange={(e) => setPropTypeFilter(e.target.value)}>
                  <option value="All">Any prop</option>
                  {propTypeOptions.map((pt) => <option key={pt} value={pt}>{pt}</option>)}
                </select>
              </div>
              {/* Over/Under */}
              <div title={selectedSport === 'NFL' ? "NFL sportsbook props aren't connected yet" : undefined} className={`relative flex min-w-0 flex-col rounded-lg border border-white/8 bg-white/3 px-2.5 py-2 hover:border-white/15 ${selectedSport === 'NFL' ? 'cursor-not-allowed opacity-40' : ''}`}>
                <div className="flex items-center gap-1"><svg className="h-3 w-3 text-slate-500" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} viewBox="0 0 24 24"><path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/></svg><span className="text-[10px] text-slate-500">Over / Under</span></div>
                <div className="flex items-center justify-between"><span className="text-sm text-white">{oddsFilter === "All" ? "Any" : oddsFilter}</span><span className="text-[10px] text-slate-600">&#x25be;</span></div>
                <select disabled={selectedSport === 'NFL'} className="absolute inset-0 cursor-pointer rounded-xl opacity-0 disabled:cursor-not-allowed" value={oddsFilter} onChange={(e) => setOddsFilter(e.target.value)}>
                  <option value="All">Any</option>
                  <option value="Over">Over</option>
                  <option value="Under">Under</option>
                </select>
              </div>
              {/* Min Confidence */}
              <div title={selectedSport === 'NFL' ? "NFL sportsbook props aren't connected yet" : undefined} className={`relative flex min-w-0 flex-col rounded-lg border border-white/8 bg-white/3 px-2.5 py-2 hover:border-white/15 ${selectedSport === 'NFL' ? 'cursor-not-allowed opacity-40' : ''}`}>
                <div className="flex items-center gap-1"><svg className="h-3 w-3 text-slate-500" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} viewBox="0 0 24 24"><path d="M18 20V10M12 20V4M6 20v-6"/></svg><span className="text-[10px] text-slate-500">Min Confidence</span></div>
                <div className="flex items-center justify-between"><span className="text-sm text-white">{confidenceFilter === "0" ? "Any" : confidenceFilter + "%+"}</span><span className="text-[10px] text-slate-600">&#x25be;</span></div>
                <select disabled={selectedSport === 'NFL'} className="absolute inset-0 cursor-pointer rounded-xl opacity-0 disabled:cursor-not-allowed" value={confidenceFilter} onChange={(e) => setConfidenceFilter(e.target.value)}>
                  <option value="0">Any</option>
                  <option value="65">65%+</option>
                  <option value="70">70%+</option>
                  <option value="75">75%+</option>
                  <option value="80">80%+</option>
                </select>
              </div>
              {/* Sort By */}
              <div title={selectedSport === 'NFL' ? "NFL sportsbook props aren't connected yet" : undefined} className={`relative flex min-w-0 flex-col rounded-lg border border-white/8 bg-white/3 px-2.5 py-2 hover:border-white/15 ${selectedSport === 'NFL' ? 'cursor-not-allowed opacity-40' : ''}`}>
                <div className="flex items-center gap-1"><svg className="h-3 w-3 text-slate-500" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} viewBox="0 0 24 24"><path d="M4 6h16M4 12h10M4 18h6"/></svg><span className="text-[10px] text-slate-500">Sort By</span></div>
                <div className="flex items-center justify-between"><span className="text-sm text-white">{sortBy === "confidence" ? "Highest Edge" : sortBy === "projectedValue" ? "Proj Value" : "Best " + sortBy.replace("last", "L")}</span><span className="text-[10px] text-slate-600">&#x25be;</span></div>
                <select disabled={selectedSport === 'NFL'} className="absolute inset-0 cursor-pointer rounded-xl opacity-0 disabled:cursor-not-allowed" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                  <option value="confidence">Highest Edge</option>
                  <option value="projectedValue">Highest Value</option>
                  <option value="last5">Best L5</option>
                  <option value="last10">Best L10</option>
                </select>
              </div>
            </div>

            {/* Advanced filters toggle + row */}
            <div className="mb-3">
              <button
                onClick={() => setShowAdvanced((v) => !v)}
                disabled={selectedSport === 'NFL'}
                title={selectedSport === 'NFL' ? "NFL sportsbook props aren't connected yet" : undefined}
                className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/3 px-3 py-2 text-xs text-slate-300 transition hover:border-white/15 hover:text-white disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-white/8 disabled:hover:text-slate-300"
              >
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24"><path d="M3 6h18M6 12h12M10 18h4"/></svg>
                Advanced Filters
                {advancedCount > 0 && <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-[9px] font-bold text-slate-950">{advancedCount}</span>}
                <span className="ml-auto text-[10px] text-slate-600">{showAdvanced ? "▲" : "▾"}</span>
              </button>

              {showAdvanced && selectedSport !== 'NFL' && (
                <div className="mt-2 space-y-2 rounded-xl border border-white/6 bg-white/3 p-3">
                  <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
                    {/* Home/Away */}
                    <div className="relative flex flex-col rounded-lg border border-white/6 bg-white/3 px-2.5 py-2 hover:border-white/12">
                      <span className="text-[9px] text-slate-600">Home / Away</span>
                      <div className="flex items-center justify-between"><span className="text-xs text-white">{homeAwayFilter === "All" ? "Any" : homeAwayFilter}</span><span className="text-[9px] text-slate-600">&#x25be;</span></div>
                      <select className="absolute inset-0 cursor-pointer rounded-lg opacity-0" value={homeAwayFilter} onChange={(e) => setHomeAwayFilter(e.target.value)}>
                        <option value="All">Any</option>
                        <option value="Home">Home</option>
                        <option value="Away">Away</option>
                      </select>
                    </div>
                    {/* L5 Hit Rate */}
                    <div className="relative flex flex-col rounded-lg border border-white/6 bg-white/3 px-2.5 py-2 hover:border-white/12">
                      <span className="text-[9px] text-slate-600">L5 Hit Rate</span>
                      <div className="flex items-center justify-between"><span className="text-xs text-white">{l5Filter === "0" ? "Any" : l5Filter + "%+"}</span><span className="text-[9px] text-slate-600">&#x25be;</span></div>
                      <select className="absolute inset-0 cursor-pointer rounded-lg opacity-0" value={l5Filter} onChange={(e) => setL5Filter(e.target.value)}>
                        <option value="0">Any</option>
                        <option value="50">50%+</option>
                        <option value="60">60%+</option>
                        <option value="70">70%+</option>
                      </select>
                    </div>
                    {/* L10 Hit Rate */}
                    <div className="relative flex flex-col rounded-lg border border-white/6 bg-white/3 px-2.5 py-2 hover:border-white/12">
                      <span className="text-[9px] text-slate-600">L10 Hit Rate</span>
                      <div className="flex items-center justify-between"><span className="text-xs text-white">{l10Filter === "0" ? "Any" : l10Filter + "%+"}</span><span className="text-[9px] text-slate-600">&#x25be;</span></div>
                      <select className="absolute inset-0 cursor-pointer rounded-lg opacity-0" value={l10Filter} onChange={(e) => setL10Filter(e.target.value)}>
                        <option value="0">Any</option>
                        <option value="50">50%+</option>
                        <option value="60">60%+</option>
                        <option value="70">70%+</option>
                      </select>
                    </div>
                    {/* L20 Hit Rate */}
                    <div className="relative flex flex-col rounded-lg border border-white/6 bg-white/3 px-2.5 py-2 hover:border-white/12">
                      <span className="text-[9px] text-slate-600">L20 Hit Rate</span>
                      <div className="flex items-center justify-between"><span className="text-xs text-white">{l20Filter === "0" ? "Any" : l20Filter + "%+"}</span><span className="text-[9px] text-slate-600">&#x25be;</span></div>
                      <select className="absolute inset-0 cursor-pointer rounded-lg opacity-0" value={l20Filter} onChange={(e) => setL20Filter(e.target.value)}>
                        <option value="0">Any</option>
                        <option value="50">50%+</option>
                        <option value="60">60%+</option>
                        <option value="70">70%+</option>
                      </select>
                    </div>
                    {/* Min Sample */}
                    <div className="relative flex flex-col rounded-lg border border-white/6 bg-white/3 px-2.5 py-2 hover:border-white/12">
                      <span className="text-[9px] text-slate-600">Min Sample Size</span>
                      <div className="flex items-center justify-between"><span className="text-xs text-white">{sampleFilter === "0" ? "Any" : sampleFilter + "+"}</span><span className="text-[9px] text-slate-600">&#x25be;</span></div>
                      <select className="absolute inset-0 cursor-pointer rounded-lg opacity-0" value={sampleFilter} onChange={(e) => setSampleFilter(e.target.value)}>
                        <option value="0">Any</option>
                        <option value="10">10+</option>
                        <option value="20">20+</option>
                        <option value="30">30+</option>
                      </select>
                    </div>
                  </div>
                  {activeTags.length > 0 && (
                    <button onClick={clearAllFilters} className="text-xs text-emerald-400 hover:text-emerald-300">Clear All Filters &times;</button>
                  )}
                </div>
              )}
            </div>

            {/* Active filter tags */}
            {activeTags.length > 0 && (
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                {activeTags.map((tag) => (
                  <button key={tag.label} onClick={tag.clear}
                    className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-slate-300 transition hover:border-rose-500/30 hover:text-rose-400">
                    {tag.label} <span>&times;</span>
                  </button>
                ))}
                <button onClick={clearAllFilters} className="ml-1 text-[11px] text-emerald-400 hover:text-emerald-300">Clear All Filters</button>
              </div>
            )}

            {/* Results header */}
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3 text-sm">
                {selectedSport === 'NFL' ? (
                  <span className="text-slate-400">NFL opportunities table not available yet — search a player above</span>
                ) : (
                  <>
                    <span className="text-slate-400">Showing <span className="font-semibold text-white">{visibleProps.length}</span> of <span className="font-semibold text-white">{filteredProps.length}</span> opportunities</span>
                    <span className="text-slate-600">Sorted by: <span className="text-slate-400">{sortBy === "confidence" ? "Highest Edge" : "Custom"}</span></span>
                  </>
                )}
              </div>
              {selectedIds.size > 0 && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">{selectedIds.size} selected</span>
                  <button
                    onClick={() => comparePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    disabled={selectedIds.size < 2}
                    title={selectedIds.size < 2 ? 'Select at least 2 props to compare' : undefined}
                    className="rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Compare {Math.min(selectedIds.size, 3)} Props
                  </button>
                  <button onClick={clearSelection} className="rounded-xl border border-white/8 px-3 py-1.5 text-xs text-slate-300 hover:text-white">Clear Selection</button>
                </div>
              )}
            </div>

            {/* Select all row */}
            {selectedSport !== 'NFL' && (
              <div className="mb-2 flex items-center gap-3 rounded-xl border border-white/5 bg-white/2 px-3 py-2">
                <input type="checkbox" checked={selectedIds.size === visibleProps.length && visibleProps.length > 0}
                  onChange={() => selectedIds.size === visibleProps.length ? clearSelection() : selectAll()}
                  className="h-4 w-4 cursor-pointer appearance-none rounded border border-white/20 bg-[#101714] checked:border-emerald-400 checked:bg-emerald-500 accent-emerald-500" />
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-600">Select All</span>
                <div className="ml-auto flex gap-8 text-[9px] font-semibold uppercase tracking-wider text-slate-600">
                  <span>Prop</span><span>Line</span><span>Odds</span><span>Conf.</span>
                  <span>L5</span><span>L10</span><span>L20</span><span>Season</span>
                </div>
              </div>
            )}

            {/* Results list */}
            <div className="space-y-2">
              {playerFilter.trim().length >= 2 && selectedSport === 'MLB' ? <div className="rounded-xl border border-white/6 bg-white/3 p-3"><p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Live MLB players</p>{liveSearchLoading ? <p className="text-sm text-slate-400">Searching players…</p> : null}{liveSearchError ? <p className="text-sm text-slate-400">Data unavailable.</p> : null}{!liveSearchLoading && !liveSearchError && livePlayers.length === 0 ? <p className="text-sm text-slate-400">No active MLB players found.</p> : null}<div className="space-y-1">{livePlayers.map((player) => <Link key={player.id} href={getResearchHref({ playerId: player.id, date: selectedDate })} className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-white/5"><PlayerAvatar playerId={player.id} playerName={player.name} size={32} /><div className="min-w-0"><p className="text-sm font-semibold text-white">{player.name}</p><p className="text-xs text-slate-500">{player.currentTeam?.name ?? 'Data unavailable'} • {player.position ?? 'Data unavailable'}</p></div><span className="ml-auto text-xs font-semibold text-emerald-400">Research →</span></Link>)}</div></div> : null}
              {playerFilter.trim().length >= 2 && selectedSport === 'NFL' ? <div className="rounded-xl border border-white/6 bg-white/3 p-3"><p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">Live NFL players</p>{liveNFLSearchLoading ? <p className="text-sm text-slate-400">Searching players…</p> : null}{liveNFLSearchError ? <p className="text-sm text-slate-400">Data unavailable.</p> : null}{!liveNFLSearchLoading && !liveNFLSearchError && liveNFLPlayers.length === 0 ? <p className="text-sm text-slate-400">No active NFL players found.</p> : null}<div className="space-y-1">{liveNFLPlayers.map((player) => <Link key={player.id} href={getResearchHref({ playerId: player.id, sport: 'nfl', date: selectedDate })} className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-white/5"><NFLPlayerAvatar headshotUrl={player.headshotUrl} playerName={player.name} size={32} /><div className="min-w-0"><p className="text-sm font-semibold text-white">{player.name}</p><p className="text-xs text-slate-500">{player.team?.displayName ?? 'Data unavailable'} • {player.positionName ?? player.position ?? 'Data unavailable'}</p></div>{player.team?.logoUrl ? <img src={player.team.logoUrl} alt={player.team.displayName} className="h-5 w-5 object-contain" /> : null}<span className="ml-1 text-xs font-semibold text-emerald-400">Research →</span></Link>)}</div></div> : null}
              {selectedSport === 'MLB' && liveListLoading && (
                <p className="rounded-xl border border-white/6 bg-white/3 p-4 text-sm text-slate-400">Loading live MLB opportunities…</p>
              )}
              {selectedSport === 'MLB' && !liveListLoading && liveListError && (
                <p className="rounded-xl border border-white/6 bg-white/3 p-4 text-sm text-slate-400">Live odds data unavailable.</p>
              )}
              {selectedSport === 'NFL' && (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-white/6 bg-white/3 p-10 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-2xl">&#x2301;</div>
                  <h3 className="mt-4 text-lg font-semibold text-white">NFL sportsbook props aren&rsquo;t connected yet</h3>
                  <p className="mt-1 text-sm text-slate-400">Search for an NFL player above to open their live stats page.</p>
                </div>
              )}
              {visibleProps.length === 0 && selectedSport !== 'NFL' && !(selectedSport === 'MLB' && liveListLoading) && (
                <div className="flex flex-col items-center justify-center rounded-2xl border border-white/6 bg-white/3 p-10 text-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/10 text-2xl">&#x2301;</div>
                  <h3 className="mt-4 text-lg font-semibold text-white">No props match your filters</h3>
                  <p className="mt-1 text-sm text-slate-400">Try broadening the filters or clearing selections.</p>
                  <button onClick={clearAllFilters} className="mt-4 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-emerald-400">Clear Filters</button>
                </div>
              )}
              {selectedSport !== 'NFL' && visibleProps.map((prop, index) => {
                const badge = confidenceBadge(prop.confidence);
                const isSelected = selectedIds.has(prop.id);
                return (
                  <div key={`${prop.id}-result-${index}`} className={`research-result-grid rounded-xl border px-3 py-2.5 transition ${isSelected ? "border-emerald-500/25 bg-emerald-500/5" : "border-white/6 bg-white/3 hover:border-white/10 hover:bg-white/5"}`}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(prop)} className="h-4 w-4 shrink-0 cursor-pointer appearance-none rounded border border-white/20 bg-[#101714] checked:border-emerald-400 checked:bg-emerald-500 accent-emerald-500" />

                    {/* Player info */}
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="relative shrink-0">
                        <PlayerAvatar playerId={prop.playerId} playerName={prop.player} size={38} className="ring-1 ring-white/10" />
                        <TeamLogo teamId={prop.teamId} abbreviation={prop.team.slice(0,3)} size={14} className="absolute -bottom-0.5 -right-0.5 ring-1 ring-[#060d18]" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-white truncate">{prop.player}</p>
                        <p className="text-[10px] text-slate-500 truncate">{prop.team} {prop.homeAway === "Away" ? "@" : "vs"} {prop.opponent}</p>
                        <p className="text-[9px] text-slate-600">{prop.gameTime}{prop.temperature ? <span> &#x2600;&#xFE0F; {prop.temperature}</span> : null}</p>
                      </div>
                    </div>

                    {/* Prop */}
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-white">{prop.researchSide} {prop.line}</p>
                      <p className="text-[10px] text-slate-500">{prop.propType}</p>
                    </div>

                    {/* Line */}
                    <div className="text-center">
                      <p className="text-xs font-semibold text-white">{prop.line}</p>
                    </div>

                    {/* Odds */}
                    <div className="text-center">
                      <p className={`text-xs font-bold ${(prop.researchSide === 'Over' ? prop.overOdds : prop.underOdds).startsWith("+") ? "text-emerald-400" : "text-slate-300"}`}>{prop.researchSide === 'Over' ? prop.overOdds : prop.underOdds}</p>
                    </div>

                    {/* Confidence */}
                    <div className="text-center">
                      <p className={`text-xl font-extrabold ${prop.confidence >= 80 ? "text-emerald-400" : prop.confidence >= 70 ? "text-teal-400" : "text-amber-400"}`}>{prop.confidence}%</p>
                      <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[8px] font-semibold ${badge.cls}`}>{badge.text}</span>
                    </div>

                    {/* Hit rates */}
                    <div className="research-hit-rates grid grid-cols-4 items-center gap-1">
                      <HitRateMini label="L5" value={prop.hitRates.last5 < 0 ? null : prop.hitRates.last5} />
                      <HitRateMini label="L10" value={prop.hitRates.last10 < 0 ? null : prop.hitRates.last10} />
                      <HitRateMini label="L20" value={prop.hitRates.last20 < 0 ? null : prop.hitRates.last20} />
                      <HitRateMini label="SZN" value={prop.hitRates.season < 0 ? null : prop.hitRates.season} />
                    </div>

                    {/* Research button */}
                    <div className="flex min-w-0 items-center justify-end gap-1.5">
                      <Link href={getResearchHref({ playerId: prop.playerId, opportunityId: prop.id, market: prop.marketKey, date: selectedDate })} onClick={() => handleResearch(prop)}
                        className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-400 transition hover:bg-emerald-500/20">
                        Research &#x2192;
                      </Link>
                      <AddPickButton id={prop.id} playerId={prop.playerId} playerName={prop.player} teamId={prop.teamId} teamName={prop.team} opponentName={prop.opponent} gameTime={prop.gameTime} propType={prop.propType} side={prop.researchSide.toLowerCase() as 'over' | 'under'} line={Number(prop.line)} odds={Number(prop.researchSide === 'Over' ? prop.overOdds : prop.underOdds)} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Load More */}
            {!showAll && filteredProps.length > PAGE_SIZE && (
              <div className="mt-4 flex flex-col items-center gap-2">
                <button onClick={() => setShowAll(true)}
                  className="flex items-center gap-2 rounded-2xl border border-white/8 bg-white/3 px-6 py-3 text-sm font-semibold text-slate-300 transition hover:border-white/15 hover:text-white">
                  Load More Opportunities &#x25be;
                </button>
                <p className="text-[10px] text-slate-600">Showing {visibleProps.length} of {filteredProps.length} opportunities</p>
              </div>
            )}
          </main>

          {/* ── Right: Research Queue + Compare + Recent ── */}
          <aside className="sticky top-0 hidden w-[290px] shrink-0 border-l border-white/10 bg-[#080f0d] p-4 pl-5 xl:block">
            <NewsUnavailablePanel className="max-h-[calc(100vh-124px)]" />

            {/* Research Queue */}
            <div className="mb-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold text-white">Research Queue</h3>
                {queueItems.length > 0 && <button onClick={clearSelection} className="text-xs text-slate-400 hover:text-white">Clear Queue</button>}
              </div>
              {queueItems.length === 0 ? (
                <p className="rounded-xl bg-white/3 p-3 text-center text-xs text-slate-500">Select props to build your research queue.</p>
              ) : (
                <>
                  <p className="mb-2 text-[10px] text-slate-500">{queueItems.length} props selected</p>
                  <div className="space-y-1">
                    {queueItems.map((prop, i) => (
                      <div key={`${prop.id}-queue-${i}`} className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/3 px-2.5 py-2 text-xs">
                        <span className="w-4 shrink-0 text-center font-bold text-slate-600">{i + 1}</span>
                        <PlayerAvatar playerId={prop.playerId} playerName={prop.player} size={22} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-white">{prop.player}</p>
                          <p className="truncate text-[9px] text-slate-500">{prop.propType} {prop.researchSide} {prop.line}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="text-[10px] text-slate-400">{prop.researchSide === 'Over' ? prop.overOdds : prop.underOdds}</p>
                          <p className={`text-[10px] font-bold ${prop.confidence >= 80 ? "text-emerald-400" : "text-teal-400"}`}>{prop.confidence}%</p>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <button onClick={() => moveQueueUp(prop.id)} className="text-slate-600 hover:text-white">&#x2191;</button>
                          <button onClick={() => moveQueueDown(prop.id)} className="text-slate-600 hover:text-white">&#x2193;</button>
                        </div>
                        <button onClick={() => toggleSelect(prop)} className="text-slate-600 hover:text-rose-400">&#x2715;</button>
                      </div>
                    ))}
                  </div>
                  <Link href="/research" className="mt-2 block text-[10px] text-emerald-400 hover:text-emerald-300">View Full Queue &#x2192;</Link>
                </>
              )}
            </div>

            {/* Compare Props */}
            {compareItems.length >= 2 && (
              <div ref={comparePanelRef} className="mb-5 overflow-hidden rounded-2xl border border-white/6 bg-white/3">
                <div className="flex items-center justify-between border-b border-white/5 px-3 py-2.5">
                  <h3 className="text-sm font-semibold text-white">Compare {compareItems.length} Props</h3>
                  <button onClick={clearSelection} className="text-xs text-slate-400 hover:text-white">Clear</button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-white/5">
                        <th className="px-2 py-2 text-left text-[9px] font-semibold uppercase text-slate-600">Metric</th>
                        {compareItems.map((p, index) => (
                          <th key={`${p.id}-compare-header-${index}`} className="px-2 py-2 text-center">
                            <PlayerAvatar playerId={p.playerId} playerName={p.player} size={24} className="mx-auto" />
                            <p className="mt-1 text-[9px] font-semibold text-white">{p.player.split(" ")[1]}</p>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/4">
                      {[
                        { key: "prop", label: "Prop", fn: (p: PropResearchItem) => p.propType },
                        { key: "line", label: "Line", fn: (p: PropResearchItem) => p.line },
                        { key: "odds", label: "Odds", fn: (p: PropResearchItem) => (p.researchSide === 'Over' ? p.overOdds : p.underOdds) },
                        { key: "conf", label: "Conf.", fn: (p: PropResearchItem) => p.confidence + "%" },
                        { key: "l5", label: "L5", fn: (p: PropResearchItem) => (p.hitRates.last5 < 0 ? "\u2014" : p.hitRates.last5 + "%") },
                        { key: "l10", label: "L10", fn: (p: PropResearchItem) => (p.hitRates.last10 < 0 ? "\u2014" : p.hitRates.last10 + "%") },
                        { key: "l20", label: "L20", fn: (p: PropResearchItem) => (p.hitRates.last20 < 0 ? "\u2014" : p.hitRates.last20 + "%") },
                        { key: "szn", label: "Season", fn: (p: PropResearchItem) => (p.hitRates.season < 0 ? "\u2014" : p.hitRates.season + "%") },
                      ].map(({ key, label, fn }) => (
                        <tr key={key} className="hover:bg-white/4">
                          <td className="px-2 py-1.5 text-[9px] text-slate-500">{label}</td>
                          {compareItems.map((p, index) => <td key={`${p.id}-compare-value-${index}-${key}`} className="px-2 py-1.5 text-center font-semibold text-white">{fn(p)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Recently Researched */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white">Recently Researched</h3>
                <Link href="/research" className="text-xs text-emerald-400 hover:text-emerald-300">View All</Link>
              </div>
              {recentResearched.length === 0 ? (
                <p className="text-xs text-slate-500">Click &ldquo;Research &#x2192;&rdquo; on any prop to track it here.</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {recentResearched.map((prop, i) => (
                    <Link key={`${prop.id}-recent-${i}`} href={getResearchHref({ playerId: prop.playerId, opportunityId: prop.id, market: prop.marketKey, date: selectedDate })} 
                      className="flex flex-col items-center rounded-xl border border-white/5 bg-white/3 p-2.5 text-center transition hover:bg-white/7">
                      <PlayerAvatar playerId={prop.playerId} playerName={prop.player} size={32} />
                      <p className="mt-1.5 text-[9px] font-semibold text-white leading-tight">{prop.player.split(" ")[1] ?? prop.player}</p>
                      <p className="text-[8px] text-slate-500">{prop.researchSide} {prop.line} {prop.propType}</p>
                      <p className="text-[8px] text-slate-600">{i === 0 ? "2m ago" : i === 1 ? "15m ago" : i === 2 ? "1h ago" : "3h ago"}</p>
                    </Link>
                  ))}
                </div>
              )}
            </div>

          </aside>
          <NewsUnavailablePanel className="xl:hidden" />
        </div>
      </div>
    </div>
  );
}
