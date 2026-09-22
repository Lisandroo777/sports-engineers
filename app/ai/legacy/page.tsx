"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppSidebar } from "../../../components/AppSidebar";
import { NewsUnavailablePanel } from "../../../components/NewsUnavailablePanel";
import { AddPickButton } from "../../../components/AddPickButton";
import { PlayerAvatar } from "../../../components/PlayerAvatar";
import { TeamLogo } from "../../../components/TeamLogo";
import { getResearchHref } from "../../../lib/researchHref";
import { resolveSlateDate, todaySlateDate, tomorrowSlateDate, presetForSlateDate, slateDateForIntent } from "../../../lib/dateModel";
import { getCriteriaRows, interpretQuery, rankProps, type AiResult, type AiSearchCriteria } from "../../../lib/ai";
import { finderResultToListItem } from "../../../lib/finder/toPropResearchItem";
import { analyzePickCandidate, finderResultToEliteCandidate } from "../../../lib/ai/eliteResearchFilter";
import type { FinderResult, FinderRunSummary } from "../../../lib/finder/engine";

// ─── constants ────────────────────────────────────────────────────────────────

const SECONDARY_SUGGESTIONS = [
  { label: "Highest Confidence", query: "Show me 5 high confidence MLB props 80%+" },
  { label: "Best Overs", query: "Find 5 strong over props" },
  { label: "Best Unders", query: "Find 5 strong under props" },
  { label: "Pitcher Strikeouts", query: "Find pitcher strikeout props with favorable matchups" },
];

const SPORTS_TERMS = /\b(baseball|basketball|football|hockey|soccer|tennis|golf|ufc|mlb|nba|nfl|nhl|wnba|player|game|matchup|prop|odds|bet|lineup|pitcher|hitter|batter|strikeout|runs?|hits?|home run|total bases|rbi|trend|team)\b/i;

const LOADING_STEPS = [
  "Analyzing player trends...",
  "Checking matchup context...",
  "Comparing opportunities...",
  "Ranking matches...",
  "Finalizing results...",
];

const RISK_STYLES = {
  LOW: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  MEDIUM: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  HIGH: "border-rose-500/40 bg-rose-500/10 text-rose-400",
};

type SearchMode = "quick" | "deep" | "builder";
type FinderStatus = 'IDLE' | 'LOADING' | 'SLATE_COMPLETE' | 'SPORTSBOOK_UNAVAILABLE' | 'RESEARCHING' | 'NO_ELITE_RESULTS' | 'RESULTS' | 'ERROR';
const AI_FINDER_SESSION_KEY = 'deepside.ai-finder.session.v1';

interface PersistedAIFinderSession {
  sport: string;
  date: string;
  mode: SearchMode;
  query: string;
  criteria: AiSearchCriteria | null;
  results: AiResult[];
  totalMatched: number;
  finderStatus: FinderStatus;
  showCount: number;
  conversation: Array<{ role: "user" | "ai"; text: string }>;
  selectedIds: string[];
  deepSummary: FinderRunSummary | null;
  deepSummarySport: string | null;
  filters: {
    minFinderScore: number;
    minEv: number | null;
    minBooks: number;
    finderSortBy: 'score' | 'ev' | 'price' | 'time';
    finderPlayerFilter: string;
    finderTeamFilter: string;
    finderGameFilter: string;
    finderMarketFilter: string;
    finderSideFilter: 'All' | 'over' | 'under';
    finderBookFilter: string;
    finderAltFilter: 'All' | 'Standard' | 'Alternate';
  };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function MatchScoreBadge({ score }: { score: number }) {
  const color = score >= 90 ? "text-teal-300" : score >= 75 ? "text-teal-400" : "text-amber-400";
  return (
    <div className="text-center">
      <p className={`text-2xl font-extrabold ${color}`}>{score}%</p>
      <p className="text-[9px] text-slate-500">AI Match</p>
    </div>
  );
}

function HitBar({ label, value }: { label: string; value: number }) {
  const color = value >= 70 ? "bg-emerald-500" : value >= 50 ? "bg-amber-500" : "bg-rose-500";
  return (
    <div className="text-center">
      <p className={`text-xs font-semibold ${value >= 70 ? "text-emerald-400" : value >= 50 ? "text-amber-400" : "text-rose-400"}`}>{value}%</p>
      <div className="mt-0.5 h-1 w-8 overflow-hidden rounded-full bg-white/5">
        <div className={`h-full rounded-full ${color}`} style={{ width: Math.min(100, value) + "%" }} />
      </div>
      <p className="mt-0.5 text-[8px] text-slate-600">{label}</p>
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function AiFinderPage() {
  return (
    <Suspense fallback={null}>
      <AiFinderPageContent />
    </Suspense>
  );
}

function AiFinderPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [finderSport, setFinderSport] = useState(() => (searchParams.get('sport')?.toLowerCase() === 'nfl' ? 'NFL' : 'MLB'));
  const [finderDate, setFinderDate] = useState(() => resolveSlateDate(searchParams.get('date')));
  const [mode, setMode] = useState<SearchMode>("quick");
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [loadingStep, setLoadingStep] = useState(0);
  const [criteria, setCriteria] = useState<AiSearchCriteria | null>(null);
  const [results, setResults] = useState<AiResult[]>([]);
  const [totalMatched, setTotalMatched] = useState(0);
  const [showCount, setShowCount] = useState(15);
  const [conversation, setConversation] = useState<Array<{ role: "user" | "ai"; text: string }>>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [savedSearches, setSavedSearches] = useState<Array<{ name: string; query: string }>>([]);
  const [restrictionMessage, setRestrictionMessage] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveName, setSaveName] = useState("");
  // Builder state
  const [bSport, setBSport] = useState("MLB");
  const [bMarket, setBMarket] = useState("Any");
  const [bSide, setBSide] = useState("Any");
  const [bRisk, setBRisk] = useState("Any");
  const [bConf, setBConf] = useState("Any");
  const [bWindow, setBWindow] = useState("L10");

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const comparePanelRef = useRef<HTMLDivElement>(null);
  const [deepLoading, setDeepLoading] = useState(false);
  const [deepSummary, setDeepSummary] = useState<FinderRunSummary | null>(null);
  const [deepSummarySport, setDeepSummarySport] = useState<string | null>(null);
  const [deepError, setDeepError] = useState(false);
  const [finderStatus, setFinderStatus] = useState<FinderStatus>('IDLE');
  // Client-side filters/sort over the cached, already-fetched Finder results (no extra provider calls).
  const [minFinderScore, setMinFinderScore] = useState(0);
  const [minEv, setMinEv] = useState<number | null>(null);
  const [minBooks, setMinBooks] = useState(0);
  const [finderSortBy, setFinderSortBy] = useState<'score' | 'ev' | 'price' | 'time'>('score');
  const [finderPlayerFilter, setFinderPlayerFilter] = useState('');
  const [finderTeamFilter, setFinderTeamFilter] = useState('All');
  const [finderGameFilter, setFinderGameFilter] = useState('All');
  const [finderMarketFilter, setFinderMarketFilter] = useState('All');
  const [finderSideFilter, setFinderSideFilter] = useState<'All' | 'over' | 'under'>('All');
  const [finderBookFilter, setFinderBookFilter] = useState('All');
  const [finderAltFilter, setFinderAltFilter] = useState<'All' | 'Standard' | 'Alternate'>('All');
  const [sessionRestored, setSessionRestored] = useState(false);
  const sessionClearedRef = useRef(false);

  // Keep ?sport=/?date= in the URL in sync with the Finder selectors.
  useEffect(() => {
    if (!sessionRestored) return;
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    const nextSport = finderSport === 'NFL' ? 'nfl' : 'mlb';
    if (params.get('sport') === nextSport && params.get('date') === finderDate) return;
    params.set('sport', nextSport);
    params.set('date', finderDate);
    router.replace(`/ai?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finderSport, finderDate, sessionRestored]);

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(AI_FINDER_SESSION_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as PersistedAIFinderSession;
        if (saved.sport === 'MLB' || saved.sport === 'NFL') setFinderSport(saved.sport);
        if (saved.date) setFinderDate(resolveSlateDate(saved.date));
        if (saved.mode) setMode(saved.mode);
        setQuery(saved.query ?? '');
        setCriteria(saved.criteria ?? null);
        setResults(saved.results ?? []);
        setTotalMatched(saved.totalMatched ?? 0);
        setFinderStatus(saved.finderStatus ?? 'IDLE');
        setShowCount(saved.showCount ?? 15);
        setConversation(saved.conversation ?? []);
        setSelectedIds(new Set(saved.selectedIds ?? []));
        setDeepSummary(saved.deepSummary ?? null);
        setDeepSummarySport(saved.deepSummarySport ?? null);
        setMinFinderScore(saved.filters?.minFinderScore ?? 0);
        setMinEv(saved.filters?.minEv ?? null);
        setMinBooks(saved.filters?.minBooks ?? 0);
        setFinderSortBy(saved.filters?.finderSortBy ?? 'score');
        setFinderPlayerFilter(saved.filters?.finderPlayerFilter ?? '');
        setFinderTeamFilter(saved.filters?.finderTeamFilter ?? 'All');
        setFinderGameFilter(saved.filters?.finderGameFilter ?? 'All');
        setFinderMarketFilter(saved.filters?.finderMarketFilter ?? 'All');
        setFinderSideFilter(saved.filters?.finderSideFilter ?? 'All');
        setFinderBookFilter(saved.filters?.finderBookFilter ?? 'All');
        setFinderAltFilter(saved.filters?.finderAltFilter ?? 'All');
      }
    } catch {
      window.sessionStorage.removeItem(AI_FINDER_SESSION_KEY);
    } finally {
      setSessionRestored(true);
    }
  }, []);

  useEffect(() => {
    if (!sessionRestored) return;
    if (sessionClearedRef.current) {
      window.sessionStorage.removeItem(AI_FINDER_SESSION_KEY);
      return;
    }
    const session: PersistedAIFinderSession = {
      sport: finderSport,
      date: finderDate,
      mode,
      query,
      criteria,
      results,
      totalMatched,
      finderStatus,
      showCount,
      conversation,
      selectedIds: [...selectedIds],
      deepSummary: deepSummary ? { ...deepSummary, credits: null } : null,
      deepSummarySport,
      filters: {
        minFinderScore, minEv, minBooks, finderSortBy, finderPlayerFilter, finderTeamFilter,
        finderGameFilter, finderMarketFilter, finderSideFilter, finderBookFilter, finderAltFilter,
      },
    };
    try {
      window.sessionStorage.setItem(AI_FINDER_SESSION_KEY, JSON.stringify(session));
    } catch {
      // Session persistence is best-effort and must never block the Finder UI.
    }
  }, [conversation, criteria, deepSummary, deepSummarySport, finderAltFilter, finderBookFilter, finderDate, finderGameFilter, finderMarketFilter, finderPlayerFilter, finderSideFilter, finderSortBy, finderSport, finderTeamFilter, minBooks, minEv, minFinderScore, mode, query, results, selectedIds, sessionRestored, showCount, totalMatched]);

  // Re-fetching automatically on date change would silently spend/refresh provider calls behind the
  // user's back — Finder must only hit the network when the user explicitly clicks Quick Find/Deep Search.
  // NFL uses the same FinderRunSummary shape and the same cards/filters, but its endpoint never touches
  // the Odds API at all (real ESPN game count only, zero props) — keeping it credit-risk-free.
  async function fetchDeepSearch(date: string, sport: string): Promise<FinderRunSummary | null> {
    sessionClearedRef.current = false;
    setFinderStatus('LOADING');
    setDeepLoading(true);
    setDeepError(false);
    try {
      const path = sport === 'NFL' ? '/api/finder/nfl/deep-search' : '/api/finder/mlb/deep-search';
      const response = await fetch(`${path}?date=${encodeURIComponent(date)}`);
      if (!response.ok) throw new Error('Finder unavailable');
      const payload = await response.json() as { data: FinderRunSummary };
      setDeepSummary(payload.data);
      setDeepSummarySport(sport);
      setFinderStatus(payload.data.slateComplete ? 'SLATE_COMPLETE' : payload.data.propsAnalyzed === 0 ? 'SPORTSBOOK_UNAVAILABLE' : 'RESEARCHING');
      return payload.data;
    } catch {
      setDeepError(true);
      setFinderStatus('ERROR');
      return null;
    } finally {
      setDeepLoading(false);
    }
  }

  /** Deep Search always calls through (the server route itself is cache-first, so repeats cost nothing extra). */
  async function runDeepSearch() {
    await fetchDeepSearch(finderDate, finderSport);
  }

  /** Quick Find reuses whatever is already loaded for this exact date; only fetches if nothing is cached yet. */
  async function runQuickFind() {
    if (deepSummary && deepSummary.slateDate === finderDate) return;
    await fetchDeepSearch(finderDate, finderSport);
  }

  const finderGameLabel = (result: FinderResult) => `${result.teamName ?? 'Data unavailable'} vs ${result.opponentName ?? 'Data unavailable'}`;
  const visibleDeepSummary = deepSummarySport === finderSport && deepSummary?.slateDate === finderDate ? deepSummary : null;

  const finderFilterOptions = useMemo(() => {
    const results = visibleDeepSummary?.results ?? [];
    return {
      teams: Array.from(new Set(results.map((r) => r.teamName).filter((v): v is string => Boolean(v)))).sort(),
      games: Array.from(new Set(results.map(finderGameLabel))).sort(),
      markets: Array.from(new Set(results.map((r) => r.marketLabel))).sort(),
      books: Array.from(new Set(results.map((r) => r.bestBook?.sportsbookName).filter((v): v is string => Boolean(v)))).sort(),
    };
  }, [visibleDeepSummary]);

  const filteredDeepResults = useMemo(() => {
    const results = visibleDeepSummary?.results ?? [];
    const norm = finderPlayerFilter.trim().toLowerCase();
    const filtered = results.filter((result) => {
      if (!analyzePickCandidate(finderResultToEliteCandidate(result)).eliteQualified) return false;
      if (result.finderScore < minFinderScore) return false;
      if (minEv != null && (result.evPercent == null || result.evPercent < minEv)) return false;
      if (result.availableBooks < minBooks) return false;
      if (norm && !result.player.toLowerCase().includes(norm)) return false;
      if (finderTeamFilter !== 'All' && result.teamName !== finderTeamFilter) return false;
      if (finderGameFilter !== 'All' && finderGameLabel(result) !== finderGameFilter) return false;
      if (finderMarketFilter !== 'All' && result.marketLabel !== finderMarketFilter) return false;
      if (finderSideFilter !== 'All' && result.side !== finderSideFilter) return false;
      if (finderBookFilter !== 'All' && result.bestBook?.sportsbookName !== finderBookFilter) return false;
      if (finderAltFilter === 'Standard' && result.isAlternate) return false;
      if (finderAltFilter === 'Alternate' && !result.isAlternate) return false;
      return true;
    });
    return [...filtered].sort((a, b) => {
      if (finderSortBy === 'ev') return (b.evPercent ?? -Infinity) - (a.evPercent ?? -Infinity);
      if (finderSortBy === 'price') return (b.bestBook?.odds ?? -Infinity) - (a.bestBook?.odds ?? -Infinity);
      if (finderSortBy === 'time') return (a.gameTimeIso ?? '').localeCompare(b.gameTimeIso ?? '');
      return b.finderScore - a.finderScore;
    });
  }, [finderAltFilter, finderBookFilter, finderGameFilter, finderMarketFilter, finderPlayerFilter, finderSideFilter, finderSortBy, finderTeamFilter, minBooks, minEv, minFinderScore, visibleDeepSummary]);

  // ── search ──────────────────────────────────────────────────────────────────
  async function runSearch(q: string) {
    if (!q.trim()) return;
    sessionClearedRef.current = false;
    const trimmed = q.trim();
    setIsSearching(true);
    setLoadingStep(0);
    setShowCount(15);
    setSelectedIds(new Set());

    setConversation((prev) => [...prev, { role: "user", text: trimmed }]);
    setRecentSearches((prev) => [trimmed, ...prev.filter((s) => s !== trimmed)].slice(0, 5));
    setRestrictionMessage("");

    if (!SPORTS_TERMS.test(trimmed)) {
      setConversation((prev) => [...prev, { role: "ai", text: "I’m built for sports research. Ask me about a player, matchup, prop, game, odds, or sports trend." }]);
      setCriteria(null);
      setResults([]);
      setIsSearching(false);
      setRestrictionMessage("I’m built for sports research. Ask me about a player, matchup, prop, game, odds, or sports trend.");
      return;
    }

    // Simulate loading steps
    for (let i = 1; i < LOADING_STEPS.length; i++) {
      await new Promise((r) => setTimeout(r, 350));
      setLoadingStep(i);
    }

    const parsed = interpretQuery(trimmed);
    setCriteria(parsed);
    const requestDate = parsed.dateIntent ? slateDateForIntent(parsed.dateIntent) : finderDate;
    if (requestDate !== finderDate) setFinderDate(requestDate);

    if (parsed.sport !== 'MLB' && parsed.sport !== 'NFL') {
      setTotalMatched(0);
      setResults([]);
      setConversation((prev) => [...prev, { role: "ai", text: `${parsed.sport} sportsbook data is unavailable. No cross-sport fallback was used.` }]);
      setIsSearching(false);
      return;
    }

    // Reuse whatever is already cached for the current slate date — only hits the network if nothing is loaded yet.
    let summary = deepSummarySport === parsed.sport && deepSummary?.slateDate === requestDate ? deepSummary : null;
    if (!summary) {
      summary = await fetchDeepSearch(requestDate, parsed.sport);
    }
    await new Promise((r) => setTimeout(r, 300));

    const eliteCandidates = (summary?.results ?? [])
      .map((candidate) => ({ candidate, analysis: analyzePickCandidate(finderResultToEliteCandidate(candidate)) }))
      .filter(({ analysis }) => analysis.eliteQualified);
    const eliteById = new Map(eliteCandidates.map(({ candidate, analysis }) => [candidate.id, analysis]));
    const allProps = eliteCandidates.map(({ candidate }) => finderResultToListItem(candidate));
    const all = rankProps(allProps, { ...parsed, maxResults: 50 });
    setTotalMatched(all.length);
    setResults(all.slice(0, parsed.maxResults).map((result) => ({ ...result, eliteResearch: eliteById.get(result.prop.id) })));
    setFinderStatus(summary?.slateComplete ? 'SLATE_COMPLETE' : summary?.propsAnalyzed === 0 ? 'SPORTSBOOK_UNAVAILABLE' : all.length > 0 ? 'RESULTS' : 'NO_ELITE_RESULTS');

    const aiText = all.length > 0
      ? `Found ${all.length} matching opportunit${all.length === 1 ? "y" : "ies"}. Showing top ${Math.min(all.length, parsed.maxResults)} based on real Finder Score and historical hit rate.`
      : summary?.slateComplete
        ? `Every game on ${summary.slateDate} has already finished, so no props are offered. Try the next slate.`
        : summary?.propsAnalyzed === 0
          ? "Sportsbook data unavailable for this slate. No raw props were displayed."
          : "No Elite picks found. Candidates must pass the full research filter before they can be recommended.";
    setConversation((prev) => [...prev, { role: "ai", text: aiText }]);
    setIsSearching(false);
  }

  function handleSubmit() {
    if (query.trim()) runSearch(query);
  }

  function handlePrimarySearch() {
    if (query.trim()) {
      handleSubmit();
      return;
    }
    setMode('deep');
    void runDeepSearch();
  }

  function buildAndRun() {
    const parts: string[] = [];
    if (bMarket !== "Any") parts.push(bMarket.toLowerCase() + " props");
    if (bSide !== "Any") parts.push(bSide.toLowerCase() + "s");
    if (bRisk !== "Any") parts.push(bRisk.toLowerCase() + " risk");
    if (bConf !== "Any") parts.push(bConf + " confidence");
    if (bWindow !== "L10") parts.push(`strong ${bWindow} trends`);
    const q = `Find me 15 ${parts.join(", ")} ${bSport} plays`;
    setQuery(q);
    runSearch(q);
    setMode("quick");
  }

  // ── compare ─────────────────────────────────────────────────────────────────
  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else if (next.size < 4) next.add(id);
      return next;
    });
  }
  const selectedResults = results.filter((r) => selectedIds.has(r.prop.id));

  // ── save search ─────────────────────────────────────────────────────────────
  function saveCurrentSearch() {
    if (!saveName.trim() || !query) return;
    setSavedSearches((prev) => [...prev, { name: saveName.trim(), query }]);
    setSaveName("");
    setShowSaveDialog(false);
  }

  function resetSearchSession() {
    sessionClearedRef.current = true;
    window.sessionStorage.removeItem(AI_FINDER_SESSION_KEY);
    setFinderSport('MLB');
    setFinderDate(todaySlateDate());
    setMode('quick');
    setQuery('');
    setCriteria(null);
    setResults([]);
    setTotalMatched(0);
    setFinderStatus('IDLE');
    setShowCount(15);
    setConversation([]);
    setSelectedIds(new Set());
    setDeepSummary(null);
    setDeepSummarySport(null);
    setDeepError(false);
    setFinderPlayerFilter('');
    setFinderTeamFilter('All');
    setFinderGameFilter('All');
    setFinderMarketFilter('All');
    setFinderSideFilter('All');
    setFinderBookFilter('All');
    setFinderAltFilter('All');
    setMinFinderScore(0);
    setMinEv(null);
    setMinBooks(0);
    setFinderSortBy('score');
  }

  // ── sidebar footer ───────────────────────────────────────────────────────────
  const sidebarFooter = recentSearches.length > 0 ? (
    <div className="mt-4 border-t border-white/5 pt-4">
      <p className="mb-2 text-xs font-semibold text-white">Recent AI Searches</p>
      <div className="space-y-1">
        {recentSearches.map((s) => (
          <button key={s} onClick={() => { setQuery(s); runSearch(s); }}
            className="block w-full truncate rounded-lg px-2.5 py-1.5 text-left text-[11px] text-slate-400 transition hover:bg-white/7 hover:text-white">
            {s}
          </button>
        ))}
      </div>
    </div>
  ) : undefined;

  const visibleResults = results.slice(0, showCount);

  return (
    <div className="flex h-screen overflow-hidden bg-[#060d18] text-white">
      <AppSidebar currentPath="/ai" footer={sidebarFooter} />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* ── Top nav ── */}
        <header className="flex shrink-0 items-center gap-3 border-b border-white/5 bg-[#0b1522] px-4 py-2.5">
          <div className="flex max-w-sm flex-1 items-center gap-2 rounded-xl border border-white/8 bg-white/5 px-3 py-1.5 text-sm text-slate-600">
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <span>AI Finder</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl border border-white/8 bg-white/5 p-1 text-sm font-medium">
              <button onClick={() => setFinderSport('MLB')} className={`rounded-lg px-2.5 py-1 transition ${finderSport === 'MLB' ? 'bg-teal-500/20 text-teal-300' : 'text-slate-400 hover:text-white'}`}>⚾ MLB</button>
              <button onClick={() => setFinderSport('NFL')} className={`rounded-lg px-2.5 py-1 transition ${finderSport === 'NFL' ? 'bg-teal-500/20 text-teal-300' : 'text-slate-400 hover:text-white'}`}>NFL</button>
            </div>
            <div className="flex items-center gap-1 rounded-xl border border-white/8 bg-white/5 p-1 text-sm font-medium">
              <button onClick={() => setFinderDate(todaySlateDate())} className={`rounded-lg px-2.5 py-1 transition ${presetForSlateDate(finderDate) === 'today' ? 'bg-teal-500/20 text-teal-300' : 'text-slate-400 hover:text-white'}`}>Today</button>
              <button onClick={() => setFinderDate(tomorrowSlateDate())} className={`rounded-lg px-2.5 py-1 transition ${presetForSlateDate(finderDate) === 'tomorrow' ? 'bg-teal-500/20 text-teal-300' : 'text-slate-400 hover:text-white'}`}>Tomorrow</button>
            </div>
            <button onClick={resetSearchSession} title="Clear the saved AI Finder session" className="rounded-xl border border-rose-500/20 px-2.5 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10">Reset</button>
            <button disabled title="Notifications are not connected yet" className="relative flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-full border border-white/8 bg-white/5 text-slate-300 opacity-50">
              <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24"><path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/></svg>
            </button>
            <Link href="/account" className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-500/20 text-xs font-bold text-teal-400 transition hover:bg-teal-500/30">LR</Link>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className={`flex gap-5 p-5 pb-10 ${criteria ? "" : "min-h-full"}`}>

            {/* ── Center column ── */}
            <div className="flex min-w-0 flex-1 flex-col gap-5">

              {/* Prop Finder hero */}
              {!criteria && !isSearching && (
                <div className="mx-auto flex w-full max-w-[1000px] flex-1 flex-col justify-center pb-12 pt-16 text-center">
                  <p className="text-5xl font-black tracking-[-0.06em] text-white sm:text-7xl">Prop <span className="text-[#39f27f]">Finder</span></p>
                  <p className="mt-5 text-base text-slate-400 sm:text-lg">Research any prop. Find your edge.</p>
                </div>
              )}

              {/* Mode tabs */}
              <div className={`mx-auto flex w-full max-w-[1000px] rounded-2xl border border-white/6 bg-white/3 p-1 ${criteria ? "" : "mt-8"}`}>
                {([["quick", "⚡ Quick Find"], ["deep", "🔍 Deep Research"], ["builder", "🧪 Build My Research"]] as const).map(([m, label]) => (
                  <button key={m} onClick={() => setMode(m as SearchMode)}
                    className={`flex-1 rounded-xl py-2.5 text-sm font-medium transition ${mode === m ? "bg-[#39f27f] text-[#041008]" : "text-slate-500 hover:border hover:border-[#39f27f]/30 hover:text-white"}`}>
                    {label}
                  </button>
                ))}
              </div>

              {/* ── Quick / Deep search area ── */}
              {mode !== "builder" && (
                <div className={`mx-auto w-full max-w-[1000px] space-y-3 ${criteria ? "" : "mt-5"}`}>
                  <div className="flex min-h-[150px] gap-3 rounded-[18px] border border-[#39f27f]/30 bg-[#0a0e0c]/95 p-4 shadow-[0_0_28px_rgba(57,242,127,0.06)]">
                    <textarea
                      ref={inputRef}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(); } }}
                      placeholder={mode === "deep" ? "Describe the research you want in detail..." : "What prop are we looking for?"}
                      rows={4}
                      className="flex-1 resize-none bg-transparent px-2 py-1 text-base text-white outline-none placeholder:text-slate-600"
                    />
                    <button type="button" disabled title="Attaching extra context isn't supported yet" aria-label="Add context" className="flex h-10 w-10 shrink-0 cursor-not-allowed items-center justify-center self-end rounded-xl border border-white/10 text-xl text-slate-600 opacity-40">+</button>
                    <button type="button" disabled title="Voice input isn't supported yet" aria-label="Use microphone" className="flex h-10 w-10 shrink-0 cursor-not-allowed items-center justify-center self-end rounded-xl border border-white/10 text-slate-600 opacity-40">
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="10" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6" /></svg>
                    </button>
                    <button onClick={handlePrimarySearch} disabled={isSearching || deepLoading} aria-label="Search" title={query.trim() ? 'Search with AI Finder' : 'Run Deep Search for this sport and date'}
                      className="flex h-10 shrink-0 items-center justify-center gap-2 self-end rounded-xl bg-[#39f27f] px-3 text-sm font-bold text-[#041008] transition hover:bg-[#63f99a] disabled:cursor-not-allowed disabled:opacity-40">
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
                      <span>{query.trim() ? 'Search' : 'Deep Search'}</span>
                    </button>
                  </div>
                  <p className="text-center text-xs text-slate-500">✦ Ask naturally. For example: <span className="text-slate-400">&quot;Find me 15 low-risk hitter props tonight&quot;</span></p>
                  {mode === "deep" && (
                    <div className="rounded-2xl border border-white/6 bg-white/3 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <h3 className="font-semibold text-white">AI Finder — {finderSport} {presetForSlateDate(finderDate) === 'tomorrow' ? 'Tomorrow' : 'Today'}</h3>
                          <p className="text-xs text-slate-500">{finderSport === 'MLB' ? 'Analyzes the cached MLB slate using real MLB Stats API and Odds API data.' : 'Analyzes the real NFL schedule (ESPN); sportsbook props are not connected yet.'}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={runQuickFind} disabled={deepLoading} title="Reuses already-cached results for this slate — no new provider calls" className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40">⚡ Quick Find</button>
                          <button onClick={runDeepSearch} disabled={deepLoading} className="rounded-xl bg-[#39f27f] px-4 py-2 text-sm font-bold text-[#041008] transition hover:bg-[#63f99a] disabled:cursor-not-allowed disabled:opacity-50">{deepLoading ? "Analyzing…" : "🔍 Deep Search"}</button>
                        </div>
                      </div>
                      {finderSport === 'NFL' && (
                        <p className="mt-3 rounded-xl border border-white/6 bg-black/20 p-3 text-sm text-slate-400">NFL sportsbook props aren&rsquo;t connected yet — the credit-protected Odds API integration for NFL is planned for a later phase. Game/schedule data below is real (ESPN); props/EV/best-price will populate automatically once connected.</p>
                      )}
                      {deepError && <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-200">Sportsbook data unavailable. The request was not retried outside the configured Odds API reserve.</p>}
                      {visibleDeepSummary && (
                        <div className="mt-4 space-y-3">
                          <p className="text-xs text-slate-500">Last analyzed: {new Date(visibleDeepSummary.analyzedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} • Slate: {visibleDeepSummary.slateDate} • Games analyzed: {visibleDeepSummary.gamesAnalyzed} • Props analyzed: {visibleDeepSummary.propsAnalyzed} • Books analyzed: {visibleDeepSummary.booksAnalyzed}</p>
                          {finderSport === 'MLB' && (
                            <p className="rounded-lg border border-white/8 bg-black/20 px-3 py-1.5 font-mono text-[10px] text-slate-500">
                              [dev] source={visibleDeepSummary.fromCache ? "cache" : "network"} • cacheAge={visibleDeepSummary.cacheAgeMs != null ? `${Math.round(visibleDeepSummary.cacheAgeMs / 1000)}s` : "n/a"} • credits.remaining={visibleDeepSummary.credits?.remaining ?? "unknown"} • credits.used={visibleDeepSummary.credits?.used ?? "unknown"}{visibleDeepSummary.budgetLimited ? " • BUDGET-LIMITED (some games skipped)" : ""}
                            </p>
                          )}

                          {/* Filters + sort — all client-side over the already-fetched results, zero extra provider calls */}
                          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/6 bg-black/10 p-2.5">
                            <input value={finderPlayerFilter} onChange={(e) => setFinderPlayerFilter(e.target.value)} placeholder="Player" className="w-28 rounded-md border border-white/10 bg-[#0c1310] px-1.5 py-1 text-[11px] text-white placeholder:text-slate-600" />
                            <label className="flex items-center gap-1.5 text-[11px] text-slate-400">Team
                              <select value={finderTeamFilter} onChange={(e) => setFinderTeamFilter(e.target.value)} className="rounded-md border border-white/10 bg-[#0c1310] px-1.5 py-1 text-white">
                                <option value="All">Any</option>{finderFilterOptions.teams.map((t) => <option key={t} value={t}>{t}</option>)}
                              </select>
                            </label>
                            <label className="flex items-center gap-1.5 text-[11px] text-slate-400">Game
                              <select value={finderGameFilter} onChange={(e) => setFinderGameFilter(e.target.value)} className="rounded-md border border-white/10 bg-[#0c1310] px-1.5 py-1 text-white">
                                <option value="All">Any</option>{finderFilterOptions.games.map((g) => <option key={g} value={g}>{g}</option>)}
                              </select>
                            </label>
                            <label className="flex items-center gap-1.5 text-[11px] text-slate-400">Prop
                              <select value={finderMarketFilter} onChange={(e) => setFinderMarketFilter(e.target.value)} className="rounded-md border border-white/10 bg-[#0c1310] px-1.5 py-1 text-white">
                                <option value="All">Any</option>{finderFilterOptions.markets.map((m) => <option key={m} value={m}>{m}</option>)}
                              </select>
                            </label>
                            <label className="flex items-center gap-1.5 text-[11px] text-slate-400">Side
                              <select value={finderSideFilter} onChange={(e) => setFinderSideFilter(e.target.value as typeof finderSideFilter)} className="rounded-md border border-white/10 bg-[#0c1310] px-1.5 py-1 text-white">
                                <option value="All">Any</option><option value="over">Over</option><option value="under">Under</option>
                              </select>
                            </label>
                            <label className="flex items-center gap-1.5 text-[11px] text-slate-400">Book
                              <select value={finderBookFilter} onChange={(e) => setFinderBookFilter(e.target.value)} className="rounded-md border border-white/10 bg-[#0c1310] px-1.5 py-1 text-white">
                                <option value="All">Any</option>{finderFilterOptions.books.map((b) => <option key={b} value={b}>{b}</option>)}
                              </select>
                            </label>
                            <label className="flex items-center gap-1.5 text-[11px] text-slate-400">Type
                              <select value={finderAltFilter} onChange={(e) => setFinderAltFilter(e.target.value as typeof finderAltFilter)} className="rounded-md border border-white/10 bg-[#0c1310] px-1.5 py-1 text-white">
                                <option value="All">Any</option><option value="Standard">Standard</option><option value="Alternate">Alternate</option>
                              </select>
                            </label>
                            <label className="flex items-center gap-1.5 text-[11px] text-slate-400">Min Score
                              <select value={minFinderScore} onChange={(e) => setMinFinderScore(Number(e.target.value))} className="rounded-md border border-white/10 bg-[#0c1310] px-1.5 py-1 text-white">
                                <option value={0}>Any</option><option value={75}>75+</option><option value={80}>80+</option><option value={85}>85+</option><option value={90}>90+</option>
                              </select>
                            </label>
                            <label className="flex items-center gap-1.5 text-[11px] text-slate-400">Min EV
                              <select value={minEv ?? ''} onChange={(e) => setMinEv(e.target.value === '' ? null : Number(e.target.value))} className="rounded-md border border-white/10 bg-[#0c1310] px-1.5 py-1 text-white">
                                <option value="">Any</option><option value={0}>0%+</option><option value={3}>3%+</option><option value={5}>5%+</option>
                              </select>
                            </label>
                            <label className="flex items-center gap-1.5 text-[11px] text-slate-400">Min Books
                              <select value={minBooks} onChange={(e) => setMinBooks(Number(e.target.value))} className="rounded-md border border-white/10 bg-[#0c1310] px-1.5 py-1 text-white">
                                <option value={0}>Any</option><option value={2}>2+</option><option value={3}>3+</option><option value={4}>4+</option>
                              </select>
                            </label>
                            <label className="flex items-center gap-1.5 text-[11px] text-slate-400">Sort
                              <select value={finderSortBy} onChange={(e) => setFinderSortBy(e.target.value as typeof finderSortBy)} className="rounded-md border border-white/10 bg-[#0c1310] px-1.5 py-1 text-white">
                                <option value="score">Finder Score</option><option value="ev">EV</option><option value="price">Best Price</option><option value="time">Game Time</option>
                              </select>
                            </label>
                            <button
                              onClick={() => { setFinderPlayerFilter(''); setFinderTeamFilter('All'); setFinderGameFilter('All'); setFinderMarketFilter('All'); setFinderSideFilter('All'); setFinderBookFilter('All'); setFinderAltFilter('All'); setMinFinderScore(0); setMinEv(null); setMinBooks(0); }}
                              className="ml-auto rounded-md border border-white/10 px-2 py-1 text-[11px] text-slate-400 hover:text-white"
                            >
                              Clear Filters
                            </button>
                          </div>

                          {filteredDeepResults.length === 0 && visibleDeepSummary.propsAnalyzed > 0 && <p className="text-sm text-slate-400">No Elite picks found. Candidates must pass the full research filter before they can be recommended.</p>}
                          {filteredDeepResults.length === 0 && visibleDeepSummary.slateComplete && <p className="text-sm text-amber-200">Every game on {visibleDeepSummary.slateDate} has already finished, so sportsbooks no longer offer props. Try the next slate.</p>}
                          {filteredDeepResults.length === 0 && !visibleDeepSummary.slateComplete && visibleDeepSummary.propsAnalyzed === 0 && <p className="text-sm text-amber-200">Sportsbook data unavailable for this slate. No raw props were displayed.</p>}
                          <div className="space-y-2">
                            {filteredDeepResults.slice(0, 15).map((result: FinderResult, index: number) => (
                              <div key={result.id} className="rounded-xl border border-white/6 bg-white/3 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-3">
                                    <PlayerAvatar playerId={result.playerId ?? undefined} playerName={result.player} size={36} />
                                    <div>
                                      <p className="text-sm font-bold text-white">#{index + 1} {result.player}</p>
                                      <p className="text-xs text-slate-400">{result.side === 'over' ? 'Over' : 'Under'} {result.line} {result.marketLabel}{result.isAlternate ? ' (Alternate)' : ''}</p>
                                      <p className="text-[10px] text-slate-500">
                                        {result.teamName ?? 'Data unavailable'} {result.homeAway === 'away' ? '@' : 'vs'} {result.opponentName ?? 'Data unavailable'}
                                        {result.gameTimeIso ? ` • ${new Date(result.gameTimeIso).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}` : ''}
                                      </p>
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-3 text-right">
                                    <div><p className="text-lg font-extrabold text-[#39f27f]">{analyzePickCandidate(finderResultToEliteCandidate(result)).researchScore}</p><p className="text-[9px] text-slate-500">DeepSide Research Score</p></div>
                                    {result.evPercent != null && <div><p className="text-sm font-semibold text-emerald-400">{result.evPercent > 0 ? '+' : ''}{result.evPercent.toFixed(1)}%</p><p className="text-[9px] text-slate-500">Consensus EV</p></div>}
                                    {result.bestBook && <div><p className="text-sm font-semibold text-white">{result.bestBook.odds > 0 ? `+${result.bestBook.odds}` : result.bestBook.odds}</p><p className="text-[9px] text-slate-500">{result.bestBook.sportsbookName} ({result.availableBooks} books)</p></div>}
                                  </div>
                                </div>
                                <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-slate-400">
                                  <span>L5 {result.historical.l5}</span><span>L10 {result.historical.l10}</span><span>L20 {result.historical.l20}</span><span>L40 {result.historical.l40}</span><span>Season {result.historical.season}</span>
                                </div>
                                {result.signals.length > 0 && <div className="mt-2 space-y-0.5"><p className="text-[9px] font-semibold uppercase tracking-wider text-slate-600">Why it rates well</p>{result.signals.map((signal: string) => <p key={signal} className="text-[11px] text-emerald-400">• {signal}</p>)}<p className="text-[10px] text-emerald-400">• {analyzePickCandidate(finderResultToEliteCandidate(result)).signalAgreement}/{analyzePickCandidate(finderResultToEliteCandidate(result)).signalsAvailable} signals agree • trap risk {analyzePickCandidate(finderResultToEliteCandidate(result)).trapRisk}</p></div>}
                                {result.concerns.length > 0 && <div className="mt-1 space-y-0.5"><p className="text-[9px] font-semibold uppercase tracking-wider text-slate-600">Concerns</p>{result.concerns.map((concern: string) => <p key={concern} className="text-[11px] text-amber-400/80">• {concern}</p>)}</div>}
                                <div className="mt-2 flex items-center gap-2">
                                  {result.playerId ? <Link href={getResearchHref({ playerId: result.playerId, sport: result.sport, date: visibleDeepSummary.slateDate })} className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold text-emerald-400">Research</Link> : <span className="text-[10px] text-slate-500">Player ID unavailable</span>}
                                  {result.bestBook && <AddPickButton id={result.id} playerId={result.playerId ?? undefined} playerName={result.player} teamName={result.teamName ?? 'Data unavailable'} opponentName={result.opponentName ?? 'Data unavailable'} gameId={result.gameId} gameTime={result.gameTimeIso ?? ''} propType={result.marketLabel} side={result.side} line={result.line} odds={result.bestBook.odds} />}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {!criteria && (
                    <>
                      <div className="grid gap-3 pt-3 sm:grid-cols-2">
                        <button onClick={() => { setQuery("Find me the 15 best MLB plays tonight"); runSearch("Find me the 15 best MLB plays tonight"); }} className="rounded-[14px] border border-white/10 bg-white/3 px-4 py-4 text-left text-sm font-semibold text-white transition hover:-translate-y-px hover:border-[#39f27f]/35 hover:bg-[#101712]">⚡ Best Props for the Day</button>
                        <button onClick={() => { setQuery("Find me 15 plus-money MLB value plays"); runSearch("Find me 15 plus-money MLB value plays"); }} className="rounded-[14px] border border-white/10 bg-white/3 px-4 py-4 text-left text-sm font-semibold text-white transition hover:-translate-y-px hover:border-[#39f27f]/35 hover:bg-[#101712]">💎 Best Value Props</button>
                      </div>
                      <div className="flex flex-wrap justify-center gap-2 pt-2">
                        {SECONDARY_SUGGESTIONS.map((s) => <button key={s.label} onClick={() => { setQuery(s.query); runSearch(s.query); }} className="rounded-full border border-white/8 px-3 py-1.5 text-[11px] text-slate-500 transition hover:border-[#39f27f]/30 hover:text-[#39f27f]">{s.label}</button>)}
                      </div>
                    </>
                  )}
                  {restrictionMessage && <p className="pt-6 text-center text-xs text-slate-500">{restrictionMessage}</p>}
                </div>
              )}

              {/* ── Prompt Builder ── */}
              {mode === "builder" && (
                <div className="rounded-2xl border border-white/6 bg-white/3 p-5">
                  <h3 className="mb-4 font-semibold text-white">Build My Search</h3>
                  <div className="grid gap-3 sm:grid-cols-3">
                    {[
                      { label: "Sport", value: bSport, set: setBSport, opts: ["MLB", "NFL"] },
                      { label: "Market", value: bMarket, set: setBMarket, opts: ["Any", "Hits", "Total Bases", "Home Runs", "Runs", "RBIs", "Strikeouts"] },
                      { label: "Side", value: bSide, set: setBSide, opts: ["Any", "Over", "Under"] },
                      { label: "Risk Level", value: bRisk, set: setBRisk, opts: ["Any", "Low", "Medium", "High"] },
                      { label: "Min Confidence", value: bConf, set: setBConf, opts: ["Any", "65%", "70%", "75%", "80%"] },
                      { label: "Recent Window", value: bWindow, set: setBWindow, opts: ["L5", "L10", "L20", "L40", "2026"] },
                    ].map(({ label, value, set, opts }) => (
                      <div key={label} className="relative rounded-xl border border-white/8 bg-white/3 px-3 py-2.5 hover:border-white/15">
                        <p className="text-[10px] text-slate-500">{label}</p>
                        <div className="flex items-center justify-between">
                          <span className="text-sm text-white">{value}</span>
                          <span className="text-[10px] text-slate-600">▾</span>
                        </div>
                        <select className="absolute inset-0 cursor-pointer rounded-xl opacity-0" value={value} onChange={(e) => set(e.target.value)}>
                          {opts.map((o) => <option key={o} className="bg-slate-900" value={o}>{o}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                  <button onClick={buildAndRun}
                    className="mt-4 w-full rounded-xl bg-teal-500 py-3 text-sm font-bold text-slate-950 transition hover:bg-teal-400">
                    Find Plays →
                  </button>
                </div>
              )}

              {/* ── Loading animation ── */}
              {isSearching && (
                <div className="overflow-hidden rounded-2xl border border-teal-500/20 bg-teal-500/5 p-5">
                  <div className="mb-3 flex items-center gap-2">
                    <div className="h-2 w-2 animate-pulse rounded-full bg-teal-500" />
                    <p className="text-sm font-semibold text-teal-400">AI Finder is working…</p>
                  </div>
                  <div className="space-y-1.5">
                    {LOADING_STEPS.map((step, i) => (
                      <div key={step} className={`flex items-center gap-2 text-xs transition ${i <= loadingStep ? "text-white" : "text-slate-700"}`}>
                        <span>{i < loadingStep ? "✓" : i === loadingStep ? "→" : "○"}</span>
                        {step}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Results ── */}
              {!isSearching && criteria && (
                <div className="space-y-4">

                  {/* AI Conversation */}
                  {conversation.length > 0 && (
                    <div className="space-y-2">
                      {conversation.slice(-4).map((msg, i) => (
                        <div key={i} className={`flex gap-2 text-xs ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                          {msg.role === "ai" && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-500/20 text-[10px]">✨</span>}
                          <div className={`max-w-sm rounded-xl px-3 py-2 ${msg.role === "user" ? "bg-white/8 text-slate-300" : "border border-teal-500/15 bg-teal-500/8 text-teal-300"}`}>
                            {msg.text}
                          </div>
                          {msg.role === "user" && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold text-white">LR</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* AI Interpretation */}
                  <div className="rounded-2xl border border-white/6 bg-white/3 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <p className="text-xs font-semibold text-slate-400">Understanding Your Search</p>
                      <button onClick={() => { setCriteria(null); setResults([]); }}
                        className="text-xs text-teal-400 hover:text-teal-300">Edit Search</button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {getCriteriaRows(criteria).map(({ label, value }) => (
                        <span key={label} className="flex items-center gap-1 rounded-full border border-teal-500/20 bg-teal-500/8 px-2.5 py-1 text-[11px] text-teal-300">
                          <span className="text-teal-500/60">{label}:</span> {value}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Results header */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="text-sm text-slate-400">
                      Found <span className="font-semibold text-white">{totalMatched}</span> matching opportunit{totalMatched === 1 ? "y" : "ies"} &bull; Showing best <span className="font-semibold text-white">{visibleResults.length}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {selectedIds.size >= 2 && (
                        <button onClick={() => comparePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="rounded-xl bg-teal-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-teal-400">
                          Compare {selectedIds.size} Plays
                        </button>
                      )}
                      {query && (
                        <button onClick={() => setShowSaveDialog((v) => !v)}
                          className="rounded-xl border border-white/8 bg-white/3 px-3 py-1.5 text-xs text-slate-300 hover:text-white">
                          Save Search
                        </button>
                      )}
                      <button onClick={resetSearchSession} className="rounded-xl border border-rose-500/20 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10">Reset Search</button>
                    </div>
                  </div>

                  {/* Save dialog */}
                  {showSaveDialog && (
                    <div className="flex gap-2 rounded-xl border border-teal-500/20 bg-teal-500/5 p-3">
                      <input value={saveName} onChange={(e) => setSaveName(e.target.value)}
                        placeholder="Name this search..." className="flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-600" />
                      <button onClick={saveCurrentSearch} className="rounded-lg bg-teal-500 px-3 py-1 text-xs font-bold text-slate-950">Save</button>
                      <button onClick={() => setShowSaveDialog(false)} className="text-slate-500 hover:text-white">×</button>
                    </div>
                  )}

                  {/* No results */}
                  {results.length === 0 && finderStatus !== 'SPORTSBOOK_UNAVAILABLE' && (
                    <div className="rounded-2xl border border-white/6 bg-white/3 p-6 text-center">
                      <p className="text-lg font-semibold text-white">No plays matched every condition</p>
                      <p className="mt-1 text-sm text-slate-400">Try relaxing your filters to see more options.</p>
                      <div className="mt-4 flex flex-wrap justify-center gap-2">
                        {[["Relax Confidence to 65%", "Find 5 MLB plays 65% confidence"],
                          ["Remove Plus Money", "Find 5 strong MLB plays"],
                          ["Show Closest Matches", "Find MLB plays"]].map(([label, q]) => (
                          <button key={label} onClick={() => { setQuery(q); runSearch(q); }}
                            className="rounded-xl border border-teal-500/30 bg-teal-500/8 px-3 py-1.5 text-xs text-teal-400 hover:bg-teal-500/15">
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Result cards */}
                  {visibleResults.map((result, idx) => {
                    const { prop, matchScore, riskLevel, matchReasons, riskNotes, aiReason, eliteResearch } = result;
                    const isSelected = selectedIds.has(prop.id);
                    const badge = prop.confidence >= 80 ? { text: "Strong", cls: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" }
                      : prop.confidence >= 70 ? { text: "Good", cls: "bg-teal-500/15 text-teal-400 border-teal-500/25" }
                      : { text: "Average", cls: "bg-amber-500/15 text-amber-400 border-amber-500/25" };

                    return (
                      <div key={prop.id} className={`overflow-hidden rounded-2xl border p-5 transition ${isSelected ? "border-teal-500/30 bg-teal-500/5" : "border-white/6 bg-white/3 hover:border-white/10"}`}>
                        <div className="flex flex-wrap gap-4">
                          {/* Rank */}
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 text-sm font-bold text-slate-400">
                            {idx + 1}
                          </div>

                          {/* Player */}
                          <div className="flex items-center gap-3 md:w-52 md:shrink-0">
                            <div className="relative">
                              <PlayerAvatar playerId={prop.playerId} playerName={prop.player} size={44} className="ring-1 ring-white/10" />
                              <TeamLogo teamId={prop.teamId} abbreviation={prop.team.slice(0,3)} size={16} className="absolute -bottom-1 -right-1 ring-1 ring-[#060d18]" />
                            </div>
                            <div>
                              <p className="font-bold text-white">{prop.player}</p>
                              <div className="flex items-center gap-1 text-[10px] text-slate-500">
                                <TeamLogo teamId={prop.teamId} size={11} />
                                <span>{prop.team} vs {prop.opponent}</span>
                              </div>
                              {prop.gameTime && <p className="text-[9px] text-slate-600">{prop.gameTime}{prop.temperature ? ` • ${prop.temperature}` : ""}</p>}
                            </div>
                          </div>

                          {/* Prop + odds */}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-baseline gap-2">
                              <span className="font-semibold text-white">{prop.researchSide} {prop.line}</span>
                              <span className="text-sm text-slate-400">{prop.propType}</span>
                              <span className={`text-sm font-bold ${prop.overOdds.startsWith("+") ? "text-emerald-400" : "text-slate-300"}`}>{prop.overOdds}</span>
                            </div>
                            {/* Scores row */}
                            <div className="mt-2 flex flex-wrap items-center gap-4">
                              {/* AI Match Score — teal, different from confidence */}
                              <MatchScoreBadge score={matchScore} />
                              {/* Confidence — emerald */}
                              <div className="text-center">
                                <p className="text-2xl font-extrabold text-emerald-400">{eliteResearch?.researchScore ?? prop.confidence}</p>
                                <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[8px] font-semibold ${badge.cls}`}>Research Score {eliteResearch?.qualification ?? badge.text}</span>
                              </div>
                              {/* Hit rates */}
                              <div className="flex gap-3">
                                <HitBar label="L5" value={prop.hitRates.last5} />
                                <HitBar label="L10" value={prop.hitRates.last10} />
                                <HitBar label="L20" value={prop.hitRates.last20} />
                                <HitBar label="SZN" value={prop.hitRates.season} />
                              </div>
                              {/* Risk */}
                              <span className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase ${RISK_STYLES[riskLevel]}`}>{riskLevel} RISK</span>
                            </div>
                          </div>
                        </div>

                        {/* AI reason + match reasons + risk notes */}
                        <div className="mt-4 grid gap-3 rounded-xl bg-white/3 p-3 sm:grid-cols-3">
                          <div>
                            <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-teal-500">Why AI Found It</p>
                            <p className="text-[11px] italic leading-relaxed text-slate-300">&ldquo;{aiReason}&rdquo;</p>
                            {eliteResearch && <p className="mt-1 text-[10px] text-emerald-400">{eliteResearch.signalAgreement}/8 signals • {eliteResearch.dataQuality} data quality • trap risk {eliteResearch.trapRisk}</p>}
                          </div>
                          <div>
                            <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-slate-500">Why It Matched</p>
                            <div className="space-y-0.5">
                              {matchReasons.map((r) => <p key={r} className="flex items-start gap-1 text-[10px] text-emerald-400"><span>✓</span> {r}</p>)}
                            </div>
                          </div>
                          <div>
                            <p className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-slate-500">Potential Risks</p>
                            <div className="space-y-0.5">
                              {riskNotes.map((r) => <p key={r} className="flex items-start gap-1 text-[10px] text-amber-400/80"><span>⚠</span> {r}</p>)}
                            </div>
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="mt-3 flex gap-2">
                          <Link href={getResearchHref({ playerId: prop.playerId, opportunityId: prop.id, sport: prop.sport.toLowerCase() === 'nfl' ? 'nfl' : 'mlb', date: finderDate })} className="rounded-xl border border-teal-500/30 bg-teal-500/10 px-3 py-1.5 text-xs font-semibold text-teal-400 hover:bg-teal-500/20">Research →</Link>
                          <AddPickButton id={prop.id} playerId={prop.playerId} playerName={prop.player} teamId={prop.teamId} teamName={prop.team} opponentName={prop.opponent} gameTime={prop.gameTime} propType={prop.propType} side={prop.researchSide.toLowerCase() as 'over' | 'under'} line={Number(prop.line)} odds={Number(prop.overOdds)} />
                          <button onClick={() => toggleSelect(prop.id)} className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${isSelected ? "border-teal-500/40 bg-teal-500/10 text-teal-400" : "border-white/8 text-slate-400 hover:text-white"}`}>
                            {isSelected ? "Selected ✓" : "Compare"}
                          </button>
                          <Link href="/picks" className="rounded-xl border border-white/8 px-3 py-1.5 text-xs text-slate-400 hover:text-white">Add to Picks</Link>
                        </div>
                      </div>
                    );
                  })}

                  {/* Show More */}
                  {showCount < results.length && (
                    <button onClick={() => setShowCount((n) => Math.min(n + 15, results.length))}
                      className="w-full rounded-2xl border border-white/6 bg-white/3 py-3 text-sm text-slate-400 transition hover:border-white/12 hover:text-white">
                      Show More ({results.length - showCount} remaining)
                    </button>
                  )}

                  {/* Compare panel */}
                  {selectedResults.length >= 2 && (
                    <div ref={comparePanelRef} className="overflow-hidden rounded-2xl border border-teal-500/20 bg-teal-500/5">
                      <div className="border-b border-white/5 px-4 py-3 flex items-center justify-between">
                        <h3 className="font-semibold text-white">Comparing {selectedResults.length} Plays</h3>
                        <button onClick={() => setSelectedIds(new Set())} className="text-xs text-slate-400 hover:text-white">Clear</button>
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-white/5">
                              <th className="px-4 py-2 text-left text-[9px] font-semibold uppercase text-slate-600">Metric</th>
                              {selectedResults.map((r) => (
                                <th key={r.prop.id} className="px-3 py-2 text-center">
                                  <PlayerAvatar playerId={r.prop.playerId} playerName={r.prop.player} size={24} className="mx-auto" />
                                  <p className="mt-1 text-[9px] font-semibold text-white">{r.prop.player.split(" ")[1] ?? r.prop.player}</p>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/4">
                            {[
                              { label: "AI Match %", fn: (r: AiResult) => r.matchScore + "%" },
                              { label: "Confidence", fn: (r: AiResult) => r.prop.confidence + "%" },
                              { label: "Risk", fn: (r: AiResult) => r.riskLevel },
                              { label: "L5", fn: (r: AiResult) => r.prop.hitRates.last5 + "%" },
                              { label: "L10", fn: (r: AiResult) => r.prop.hitRates.last10 + "%" },
                              { label: "L20", fn: (r: AiResult) => r.prop.hitRates.last20 + "%" },
                              { label: "Odds", fn: (r: AiResult) => r.prop.overOdds },
                            ].map(({ label, fn }) => (
                              <tr key={label} className="hover:bg-white/4">
                                <td className="px-4 py-2 text-[9px] text-slate-500">{label}</td>
                                {selectedResults.map((r) => <td key={r.prop.id} className="px-3 py-2 text-center font-semibold text-white">{fn(r)}</td>)}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {/* Disclaimer */}
                  <p className="text-center text-[10px] text-slate-600">
                    DeepSide provides research and analytical tools. AI results are not guarantees of outcomes. Bet responsibly.
                  </p>
                </div>
              )}
            </div>

            {/* ── Right sidebar ── */}
            <aside className="hidden w-[240px] shrink-0 space-y-4 xl:flex xl:flex-col">
              <NewsUnavailablePanel />
              {/* Recent searches */}
              {recentSearches.length > 0 && (
                <div className="rounded-2xl border border-white/6 bg-white/3 p-4">
                  <h3 className="mb-3 text-sm font-semibold text-white">Recent AI Searches</h3>
                  <div className="space-y-1.5">
                    {recentSearches.map((s) => (
                      <button key={s} onClick={() => { setQuery(s); runSearch(s); }}
                        className="block w-full truncate rounded-lg px-2.5 py-2 text-left text-[11px] text-slate-400 transition hover:bg-white/8 hover:text-white">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Saved searches */}
              {savedSearches.length > 0 && (
                <div className="rounded-2xl border border-white/6 bg-white/3 p-4">
                  <h3 className="mb-3 text-sm font-semibold text-white">Saved Searches</h3>
                  <div className="space-y-1.5">
                    {savedSearches.map((s) => (
                      <button key={s.name} onClick={() => { setQuery(s.query); runSearch(s.query); }}
                        className="block w-full truncate rounded-lg border border-teal-500/15 px-2.5 py-2 text-left text-[11px] text-teal-400 transition hover:bg-teal-500/8">
                        {s.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Current criteria */}
              {criteria && (
                <div className="rounded-2xl border border-teal-500/15 bg-teal-500/5 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">Active Criteria</h3>
                    <button onClick={() => { setCriteria(null); setResults([]); }} className="text-[10px] text-slate-500 hover:text-white">Clear</button>
                  </div>
                  <div className="space-y-1">
                    {getCriteriaRows(criteria).map(({ label, value }) => (
                      <div key={label} className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-500">{label}</span>
                        <span className="font-semibold text-teal-400">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}
