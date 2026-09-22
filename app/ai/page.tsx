"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppSidebar } from "../../components/AppSidebar";
import { NewsUnavailablePanel } from "../../components/NewsUnavailablePanel";
import { AddPickButton } from "../../components/AddPickButton";
import { PlayerAvatar } from "../../components/PlayerAvatar";
import { PlayerHeadshot } from "../../components/PlayerHeadshot";
import { TeamLogo } from "../../components/TeamLogo";
import { getResearchHref } from "../../lib/researchHref";
import { resolveSlateDate, todaySlateDate, tomorrowSlateDate, presetForSlateDate } from "../../lib/dateModel";
import { type AiResult, type AiSearchCriteria } from "../../lib/ai";
import { finderResultToListItem } from "../../lib/finder/toPropResearchItem";
import { analyzePickCandidate, finderResultToEliteCandidate } from "../../lib/ai/eliteResearchFilter";
import { buildDeepResearchCard } from "../../lib/finder/deepResearchCard";
import type { FinderResult, FinderRunSummary } from "../../lib/finder/engine";
import type { NFLCandidate, NFLFinderSummary } from "../../lib/finder/nflEngine";
import { canAuthorizeFullSlate, safelyResearchableGames } from "../../lib/ai/refreshBudget";


// ─── constants ────────────────────────────────────────────────────────────────

const SECONDARY_SUGGESTIONS = [
  { label: "Highest Confidence", query: "Show me 5 high confidence MLB props 80%+" },
  { label: "Best Overs", query: "Find 5 strong over props" },
  { label: "Best Unders", query: "Find 5 strong under props" },
  { label: "Pitcher Strikeouts", query: "Find pitcher strikeout props with favorable matchups" },
];

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
type FinderStatus = 'IDLE' | 'LOADING' | 'SLATE_COMPLETE' | 'EVENT_LIST_REQUIRED' | 'SPORTSBOOK_DATA_REQUIRED' | 'SPORTSBOOK_UNAVAILABLE' | 'RESEARCHING' | 'NO_ELITE_RESULTS' | 'RESULTS' | 'ERROR';
const AI_FINDER_SESSION_KEY = 'deepside.ai-finder.session.v1';
/** Bump when PersistedAIFinderSession's shape changes so old/incompatible storage is safely ignored
 * instead of partially restored into a broken state. */
const AI_FINDER_SESSION_VERSION = 2;

interface ConversationEntry {
  role: "user" | "ai";
  text: string;
}

interface AgentToolTrace {
  name: string;
  status: string;
  summary: Record<string, unknown>;
}

interface AgentResultRecord {
  candidateId: string;
  rank?: number;
  playerId?: number | null;
  teamId?: number | null;
  player: string;
  team: string | null;
  opponent: string | null;
  market: string;
  marketKey: string;
  line: number | null;
  direction: 'over' | 'under';
  book: string | null;
  odds: number | null;
  projection: number | null;
  projectionUncertainty: number | null;
  edge: number | null;
  l5Rate: number | null;
  l10Rate: number | null;
  l20Rate: number | null;
  seasonRate: number | null;
  researchScore: number;
  signalAgreement: number;
  signalsAvailable: number;
  trueProbability: number | null;
  modelProbability?: number | null;
  historicalHitRate?: number | null;
  evPercent: number | null;
  priceEdgePercent: number | null;
  playerEdgePercent: number | null;
  breakEvenProbability: number | null;
  priceFreshness: string;
  priceCurrent: boolean;
  valueQualified: boolean;
  dataQuality: number;
  trapRisk: number;
  qualification: string;
  eliteQualified: boolean;
  rejectionReasons: string[];
  howItLoses: string[];
  evidenceBoard: NonNullable<AiResult['deepResearch']>['evidenceBoard'];
  bestAlternateLine: NonNullable<AiResult['deepResearch']>['bestAlternateLine'];
  grade: NonNullable<AiResult['deepResearch']>['grade'];
  priceGrade: NonNullable<AiResult['deepResearch']>['priceGrade'];
  outlierDependencePercent: number | null;
  projectionReliability?: string | null;
  crossBookThreshold?: unknown;
  marketMovement?: unknown;
  roleContext?: unknown;
  opponentContext?: unknown;
  injuryContext?: unknown;
  weatherContext?: unknown;
  sampleSize?: number | null;
  average?: number | null;
  median?: number | null;
  standardDeviation?: number | null;
  homeHitRate?: number | null;
  awayHitRate?: number | null;
}

type UiAiResult = AiResult & { sourceRecord?: AgentResultRecord; closestMiss?: boolean };

interface AgentChatResponse {
  reply: string;
  toolTrace?: AgentToolTrace[];
  results?: AgentResultRecord[];
  closestMisses?: AgentResultRecord[];
  meta?: Record<string, unknown> | null;
  /** Opaque ID for the server-side research session — never the full (possibly hundreds-of-candidates) object. */
  researchSessionId?: string | null;
  error?: string;
}

interface RefreshApprovalOffer {
  sport: 'mlb' | 'nfl' | 'nba';
  date: string;
  maxCredits: number;
  maxGames: number;
  estimatedLow: number | null;
  estimatedExpected: number | null;
  estimatedHigh: number | null;
  currentCredits: number | null;
  selectedGameIds?: string[];
  slateGames: Array<{
    gameId: string;
    matchup: string;
    gameTime: string | null;
    status: string;
    eventId: string | null;
    marketsCacheState: string;
    selected: boolean;
  }>;
  researchPriorityGames: Array<{
    gameId: string;
    matchup: string;
    gameTime: string | null;
    priority: number;
    coverage: 'HIGH' | 'MEDIUM' | 'LOW';
    selected: boolean;
    reasons: string[];
    unavailableEvidence: string[];
  }>;
}

interface PersistedAIFinderSession {
  version: number;
  sport: string;
  date: string;
  mode: SearchMode;
  query: string;
  criteria: AiSearchCriteria | null;
  results: UiAiResult[];
  totalMatched: number;
  finderStatus: FinderStatus;
  showCount: number;
  conversation: Array<{ role: "user" | "ai"; text: string }>;
  toolTrace?: AgentToolTrace[];
  agentMeta?: Record<string, unknown> | null;
  researchSessionId?: string | null;
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
  if (value < 0 || !Number.isFinite(value)) {
    return (
      <div className="text-center">
        <p className="text-xs font-semibold text-slate-600">—</p>
        <div className="mt-0.5 h-1 w-8 overflow-hidden rounded-full bg-white/5" />
        <p className="mt-0.5 text-[8px] text-slate-600">{label}</p>
      </div>
    );
  }
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

type ResearchSectionStatus = 'STRONG' | 'FAVORABLE' | 'NEUTRAL' | 'CAUTION' | 'RISK' | 'UNAVAILABLE';

const SECTION_STATUS_STYLES: Record<ResearchSectionStatus, string> = {
  STRONG: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  FAVORABLE: 'border-teal-400/30 bg-teal-400/10 text-teal-300',
  NEUTRAL: 'border-slate-400/20 bg-slate-400/8 text-slate-300',
  CAUTION: 'border-amber-400/30 bg-amber-400/10 text-amber-300',
  RISK: 'border-rose-400/30 bg-rose-400/10 text-rose-300',
  UNAVAILABLE: 'border-white/10 bg-white/5 text-slate-500',
};

function pct(value: number | null | undefined) {
  return value == null || !Number.isFinite(value) ? 'Unavailable' : `${Number(value).toFixed(1)}%`;
}

function num(value: number | null | undefined, digits = 1) {
  return value == null || !Number.isFinite(value) ? 'Unavailable' : Number(value).toFixed(digits);
}

function odds(value: string | number | null | undefined) {
  if (value == null || value === '') return 'Unavailable';
  if (typeof value === 'number') return value > 0 ? `+${value}` : String(value);
  return value;
}

function hasAllowedOfficialPrice(result: UiAiResult): boolean {
  const sourceOdds = result.sourceRecord?.odds;
  if (sourceOdds != null) return sourceOdds >= -900;
  const displayedOdds = Number(result.prop.researchSide === 'Under' ? result.prop.underOdds : result.prop.overOdds);
  return Number.isFinite(displayedOdds) && displayedOdds >= -900;
}

function recordToUiResult(record: AgentResultRecord, sport: string): UiAiResult {
  const rate = (value: number | null | undefined) => value == null ? -1 : value;
  const lineText = record.line == null ? 'Unavailable' : String(record.line);
  const oddsText = odds(record.odds);
  return {
    sourceRecord: record,
    prop: {
      id: record.candidateId,
      sport: sport.toUpperCase(),
      player: record.player,
      playerId: record.playerId ?? undefined,
      team: record.team ?? 'Unavailable',
      teamId: record.teamId ?? undefined,
      opponent: record.opponent ?? 'Unavailable',
      propType: record.market,
      marketKey: record.marketKey,
      hasSportsbookLine: record.line != null,
      sportsbookName: record.book ?? undefined,
      line: lineText,
      overOdds: record.direction === 'over' ? oddsText : 'Unavailable',
      underOdds: record.direction === 'under' ? oddsText : 'Unavailable',
      projectedValue: record.projection ?? Number.NaN,
      confidence: record.researchScore,
      confidenceLabel: record.researchScore >= 85 ? 'Strong' : record.researchScore >= 75 ? 'Good' : 'Moderate',
      gameTime: '',
      researchSide: record.direction === 'over' ? 'Over' : 'Under',
      last5: record.l5Rate == null ? 'Unavailable' : `${record.l5Rate}%`,
      last10: record.l10Rate == null ? 'Unavailable' : `${record.l10Rate}%`,
      last20: record.l20Rate == null ? 'Unavailable' : `${record.l20Rate}%`,
      last40: 'Unavailable',
      season: record.seasonRate == null ? 'Unavailable' : `${record.seasonRate}%`,
      hitRates: { last5: rate(record.l5Rate), last10: rate(record.l10Rate), last20: rate(record.l20Rate), last40: -1, season: rate(record.seasonRate) },
      gameLog: [],
      splits: { home: 'Unavailable', away: 'Unavailable', similarOpponents: 'Unavailable', recent5: 'Unavailable', recent10: 'Unavailable' },
      matchup: { opponentDefensiveRanking: 'Unavailable', opponentAllowedAverage: 'Unavailable', paceEnvironment: 'Unavailable', difficulty: record.opponent ?? 'Unavailable', recentHistory: 'Unavailable' },
      researchFactors: [],
      aiAnalysis: { summary: '', risks: '', lean: '' },
    },
    eliteResearch: {
      candidateId: record.candidateId,
      sport: sport.toLowerCase() as never,
      player: record.player,
      market: record.marketKey,
      line: record.line,
      direction: record.direction,
      isAlternate: false,
      projection: record.projection,
      rawEdge: record.edge,
      normalizedEdge: null,
      researchScore: record.researchScore,
      evidenceStrength: record.researchScore,
      evidenceCoverage: 100,
      signalAgreement: record.signalAgreement,
      signalsAvailable: record.signalsAvailable,
      signalsDisagreeing: Math.max(0, record.signalsAvailable - record.signalAgreement),
      signalsUnavailable: 0,
      agreementRatio: record.signalsAvailable ? record.signalAgreement / record.signalsAvailable : null,
      signals: [],
      trapRisk: record.trapRisk,
      trapComponents: [],
      dataQuality: record.dataQuality,
      priceFreshness: record.priceFreshness as never,
      priceCurrent: record.priceCurrent,
      valueQualified: record.valueQualified,
      breakEvenProbability: record.breakEvenProbability,
      modelProbability: record.modelProbability ?? null,
      historicalHitRatePercent: record.historicalHitRate ?? null,
      trueProbability: record.trueProbability,
      trueProbabilityBasis: null,
      distributionUsed: null,
      marketFamily: null,
      zSeparation: null,
      probabilityDivergence: null,
      priceEdgePercent: record.priceEdgePercent,
      evPercent: record.evPercent,
      rawHitRate: record.l10Rate,
      contextAdjustedHitRate: record.l10Rate,
      qualification: record.qualification as never,
      eliteQualified: record.eliteQualified,
      researchQualified: record.eliteQualified,
      rejectedReasons: record.rejectionReasons,
      trapReasons: record.howItLoses,
      whyQualified: record.evidenceBoard.filter((entry) => entry.status === 'agree').slice(0, 3).map((entry) => `${entry.signal}: ${entry.detail}`),
      riskFactors: record.howItLoses,
      adapter: sport.toUpperCase(),
      marketSupport: 'SUPPORTED',
    },
    deepResearch: {
      grade: record.grade,
      breakEvenProbability: record.breakEvenProbability,
      playerEdgePercent: record.playerEdgePercent,
      priceEdgePercent: record.priceEdgePercent,
      priceGrade: record.priceGrade,
      roleConfidence: 'Unavailable',
      matchupGrade: record.opponent ? 'Available' : 'Unavailable',
      projectedRange: null,
      bestAlternateLine: record.bestAlternateLine,
      howItLoses: record.howItLoses,
      evidenceBoard: record.evidenceBoard,
      sources: [],
      dataFreshness: record.priceFreshness,
      outlierDependencePercent: record.outlierDependencePercent,
    } as never,
    matchScore: record.researchScore,
    riskLevel: record.trapRisk <= 15 ? 'LOW' : record.trapRisk <= 25 ? 'MEDIUM' : 'HIGH',
    matchReasons: record.evidenceBoard.filter((entry) => entry.status === 'agree').map((entry) => `${entry.signal}: ${entry.detail}`),
    riskNotes: record.howItLoses.length ? record.howItLoses : record.rejectionReasons,
    aiReason: record.evidenceBoard.find((entry) => entry.status === 'agree')?.detail ?? 'Qualified by the Elite Research Filter.',
  };
}

function nflCandidateToUiResult(candidate: NFLCandidate): UiAiResult | null {
  const analysis = candidate.eliteAnalysis;
  if (!analysis || candidate.oddsAmerican < -900) return null;
  const result = recordToUiResult({
    candidateId: candidate.id, playerId: candidate.playerId, teamId: candidate.teamId,
    player: candidate.playerName, team: candidate.team, opponent: candidate.opponent,
    market: candidate.marketLabel, marketKey: candidate.market, line: candidate.line, direction: candidate.side,
    book: candidate.book, odds: candidate.oddsAmerican, projection: candidate.projection?.projection ?? null,
    projectionUncertainty: candidate.projection?.uncertainty ?? null, edge: analysis.rawEdge,
    l5Rate: candidate.history?.windows.l5.hitRate ?? null, l10Rate: candidate.history?.windows.l10.hitRate ?? null,
    l20Rate: null, seasonRate: candidate.history?.windows.season.hitRate ?? null,
    researchScore: analysis.researchScore, signalAgreement: analysis.signalAgreement, signalsAvailable: analysis.signalsAvailable,
    trueProbability: analysis.trueProbability, modelProbability: analysis.modelProbability,
    historicalHitRate: analysis.historicalHitRatePercent, evPercent: analysis.evPercent,
    priceEdgePercent: analysis.priceEdgePercent, playerEdgePercent: null,
    breakEvenProbability: analysis.breakEvenProbability, priceFreshness: analysis.priceFreshness,
    priceCurrent: analysis.priceCurrent, valueQualified: analysis.valueQualified, dataQuality: analysis.dataQuality,
    trapRisk: analysis.trapRisk, qualification: analysis.qualification, eliteQualified: true,
    rejectionReasons: analysis.rejectedReasons, howItLoses: candidate.howItLoses,
    evidenceBoard: [
      { signal: 'Projection vs Line', status: analysis.rawEdge != null ? 'agree' : 'unavailable', detail: analysis.rawEdge != null ? `Projection edge: ${analysis.rawEdge.toFixed(2)}` : 'Projection unavailable.' },
      { signal: 'Recent Form (L10)', status: candidate.history?.windows.l10.hitRate != null ? 'agree' : 'unavailable', detail: candidate.history?.windows.l10.hitRate != null ? `${candidate.history.windows.l10.hitRate}% at the exact current line.` : 'L10 history unavailable.' },
      { signal: 'Expected Role', status: candidate.roleContext.status === 'STABLE' ? 'agree' : 'unavailable', detail: candidate.roleContext.evidence[0] ?? 'Role evidence unavailable.' },
      { signal: 'Opponent Matchup', status: candidate.opponentContext?.status !== 'UNAVAILABLE' ? 'agree' : 'unavailable', detail: candidate.opponentContext?.evidence[0] ?? 'Opponent defensive matchup metrics are unavailable.' },
    ] as AgentResultRecord['evidenceBoard'],
    bestAlternateLine: candidate.alternateLines?.recommended ?? null,
    grade: analysis.eliteQualified ? 'A' : analysis.researchScore >= 75 ? 'B' : analysis.researchScore >= 60 ? 'C' : analysis.researchScore >= 40 ? 'D' : 'F', priceGrade: analysis.evPercent == null ? 'unavailable' : analysis.evPercent >= 5 ? 'A' : analysis.evPercent >= 0 ? 'B' : 'C',
    outlierDependencePercent: candidate.outlierDependency?.explosiveDependencePercent ?? null,
    projectionReliability: candidate.projection?.reliability ?? null,
    roleContext: candidate.roleContext,
    opponentContext: candidate.opponentContext ? {
      status: candidate.opponentContext.status,
      evidence: candidate.opponentContext.evidence,
      unavailableMetrics: candidate.opponentContext.missingFields,
    } : { status: 'UNAVAILABLE', evidence: candidate.opponent ? [`Scheduled opponent: ${candidate.opponent}`] : [], unavailableMetrics: ['opponent defensive boxscores'] },
    injuryContext: candidate.injuryContext,
    weatherContext: candidate.weatherContext,
    sampleSize: candidate.history?.gamesUsed ?? null, average: candidate.history?.mean ?? null,
    median: candidate.history?.median ?? null, standardDeviation: candidate.history?.stdDev ?? null,
    homeHitRate: candidate.history?.splits.home.hitRate ?? null, awayHitRate: candidate.history?.splits.away.hitRate ?? null,
  }, 'NFL');
  return { ...result, closestMiss: !analysis.eliteQualified };
}

function closestMissToUiResult(record: AgentResultRecord, sport: string): UiAiResult {
  return { ...recordToUiResult(record, sport), closestMiss: true };
}

function SectionStatusBadge({ status }: { status: ResearchSectionStatus }) {
  return <span className={`rounded-full border px-2 py-0.5 text-[9px] font-bold ${SECTION_STATUS_STYLES[status]}`}>{status}</span>;
}

function MetricTile({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'good' | 'risk' | 'muted' }) {
  const color = tone === 'good' ? 'text-emerald-300' : tone === 'risk' ? 'text-rose-300' : tone === 'muted' ? 'text-slate-500' : 'text-white';
  return (
    <div className="rounded-xl border border-white/8 bg-black/15 p-3">
      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-slate-500">{label}</p>
      <p className={`mt-1 text-sm font-bold ${color}`}>{value}</p>
    </div>
  );
}

function sectionStatus(result: AiResult, section: 'projection' | 'matchup' | 'recent' | 'role' | 'market' | 'risk' | 'how'): ResearchSectionStatus {
  const a = result.eliteResearch;
  const d = result.deepResearch;
  if (!a) return 'UNAVAILABLE';
  if (section === 'projection') return a.rawEdge == null ? 'UNAVAILABLE' : a.rawEdge > 0 && a.trueProbability != null ? 'STRONG' : 'CAUTION';
  if (section === 'matchup') return result.prop.opponent ? 'FAVORABLE' : 'UNAVAILABLE';
  if (section === 'recent') return result.prop.hitRates.last10 >= 65 ? 'STRONG' : result.prop.hitRates.last10 >= 50 ? 'NEUTRAL' : 'CAUTION';
  if (section === 'role') return result.prop.projectedPlateAppearances || result.prop.projectedValue != null ? 'NEUTRAL' : 'UNAVAILABLE';
  if (section === 'market') return a.priceCurrent && a.valueQualified ? 'STRONG' : a.priceCurrent ? 'CAUTION' : 'UNAVAILABLE';
  if (section === 'risk') return a.trapRisk <= 15 ? 'STRONG' : a.trapRisk <= 25 ? 'CAUTION' : 'RISK';
  return d?.howItLoses?.length ? 'CAUTION' : 'UNAVAILABLE';
}

function EvidenceReasons({ result }: { result: AiResult }) {
  const board = result.deepResearch?.evidenceBoard ?? [];
  const reasons = board.filter((entry) => entry.status === 'agree').slice(0, 3);
  if (!reasons.length) return <p className="text-sm text-slate-500">Evidence board is unavailable for this result.</p>;
  return (
    <div className="grid gap-2 md:grid-cols-3">
      {reasons.map((entry) => (
        <div key={entry.signal} className="rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-3">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-emerald-300">{entry.signal}</p>
          <p className="mt-1 text-xs leading-5 text-slate-300">{entry.detail}</p>
        </div>
      ))}
    </div>
  );
}

const SIGNAL_TAB_MAP: Record<string, 'research' | 'trends' | 'matchup' | 'market' | 'role'> = {
  'Recent Form (L10)': 'trends',
  'Long-Term Baseline (Season)': 'trends',
  'Projection vs Line': 'research',
  'Opponent Matchup': 'matchup',
  'Expected Role': 'role',
  'Price Value': 'market',
};

/** Clean signal-row presentation of the strongest agreeing evidence — replaces the boxed 3-up grid. */
function SignalRows({ result, onJump }: { result: AiResult; onJump: (tab: 'research' | 'trends' | 'matchup' | 'market' | 'role') => void }) {
  const board = result.deepResearch?.evidenceBoard ?? [];
  const reasons = board.filter((entry) => entry.status === 'agree').slice(0, 3);
  if (!reasons.length) return <p className="text-sm text-slate-500">Evidence board is unavailable for this result.</p>;
  const icons: Record<string, string> = { 'Recent Form (L10)': '↗', 'Long-Term Baseline (Season)': '◎', 'Projection vs Line': '◇', 'Opponent Matchup': '⬢', 'Expected Role': '●', 'Price Value': '$' };
  return (
    <div className="divide-y divide-white/6">
      {reasons.map((entry) => (
        <button key={entry.signal} onClick={() => onJump(SIGNAL_TAB_MAP[entry.signal] ?? 'research')} className="flex w-full items-start gap-3 py-2.5 text-left transition hover:bg-white/[0.03]">
          <span className="mt-0.5 text-emerald-400">{icons[entry.signal] ?? '•'}</span>
          <span className="min-w-0">
            <span className="block text-xs font-bold uppercase tracking-[0.08em] text-white">{entry.signal}</span>
            <span className="mt-0.5 block text-sm text-slate-400">{entry.detail}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

function StructuredPickCard({ result, index, expanded, selectedForCompare, onToggle, onCompare }: {
  result: UiAiResult;
  index: number;
  expanded: boolean;
  selectedForCompare: boolean;
  onToggle: () => void;
  onCompare: (id: string) => void;
}) {
  const { prop, eliteResearch: analysis, deepResearch } = result;
  const source = result.sourceRecord;
  const price = source?.odds ?? (prop.researchSide === 'Under' ? prop.underOdds : prop.overOdds);
  const edge = analysis?.priceEdgePercent ?? deepResearch?.priceEdgePercent ?? null;
  const reason = deepResearch?.evidenceBoard.find((entry) => entry.status === 'agree')?.detail ?? result.matchReasons[0] ?? 'Research evidence unavailable.';
  const risk = deepResearch?.howItLoses?.[0] ?? result.riskNotes[0] ?? 'Risk detail unavailable.';

  return (
    <article className={`rounded-2xl border bg-[#08120f] p-4 transition ${expanded ? 'border-emerald-400/50 shadow-[0_12px_40px_rgba(0,0,0,0.25)]' : 'border-white/8 hover:border-white/15'}`}>
      <div className="flex items-start gap-3">
        <PlayerHeadshot sport={prop.sport} playerId={prop.playerId} playerName={prop.player} teamId={prop.teamId} teamName={prop.team} size={64} className="ring-1 ring-white/10" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${result.closestMiss ? 'text-amber-300' : 'text-emerald-300'}`}>#{source?.rank ?? index + 1} · {result.closestMiss ? 'Closest Miss - Not an Official DeepSide Pick' : 'Elite Pick'}</p>
              <h3 className="truncate text-lg font-black text-white">{prop.player}</h3>
              <p className="truncate text-xs text-slate-400">{prop.team}{prop.opponent && prop.opponent !== 'Unavailable' ? ` vs ${prop.opponent}` : ''}</p>
            </div>
            <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[10px] font-bold text-emerald-300">{deepResearch?.grade ?? 'ELITE'}</span>
          </div>
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{prop.propType}</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-2xl font-black text-white">{prop.researchSide.toUpperCase()} {prop.line}</span>
            <span className="text-sm font-bold text-emerald-300">{odds(price)}</span>
            <span className="text-xs text-slate-500">{prop.sportsbookName ?? 'Sportsbook unavailable'}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-4 divide-x divide-white/8 border-y border-white/8 py-2 text-center">
        <div><p className="text-[9px] uppercase text-slate-500">Score</p><p className="mt-1 font-black text-white">{analysis?.researchScore ?? result.matchScore}</p></div>
        <div><p className="text-[9px] uppercase text-slate-500">Probability</p><p className="mt-1 font-black text-emerald-300">{pct(analysis?.trueProbability)}</p></div>
        <div><p className="text-[9px] uppercase text-slate-500">Edge</p><p className="mt-1 font-black text-white">{pct(edge)}</p></div>
        <div><p className="text-[9px] uppercase text-slate-500">Trap</p><p className="mt-1 font-black text-amber-300">{analysis?.trapRisk ?? 'Unavailable'}</p></div>
      </div>

      <div className="mt-3 space-y-2 text-xs leading-5">
        <p className="text-slate-300"><span className="font-bold text-emerald-300">Why:</span> {reason}</p>
        <p className="text-slate-400"><span className="font-bold text-amber-300">Risk:</span> {risk}</p>
        {result.closestMiss && <p className="rounded-lg border border-rose-400/20 bg-rose-400/5 px-2 py-1.5 text-rose-200"><span className="font-bold">FAILED ELITE:</span> {(source?.rejectionReasons ?? analysis?.rejectedReasons ?? []).join(' + ') || 'Existing Elite qualification gates were not met.'}</p>}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <button onClick={onToggle} className="rounded-xl bg-emerald-400 px-3 py-2 text-xs font-black text-slate-950 hover:bg-emerald-300">{expanded ? 'Close Research' : 'Open Research'}</button>
        <button onClick={() => onCompare(prop.id)} className={`rounded-xl border px-3 py-2 text-xs font-bold ${selectedForCompare ? 'border-emerald-400/50 text-emerald-300' : 'border-white/10 text-slate-400 hover:text-white'}`}>{selectedForCompare ? 'Selected' : 'Compare'}</button>
      </div>
    </article>
  );
}

function ResearchRow({ title, status, children, defaultOpen = false }: { title: string; status: ResearchSectionStatus; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group rounded-2xl border border-white/8 bg-white/[0.025]">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-white">{title}</span>
          <SectionStatusBadge status={status} />
        </div>
        <span className="text-slate-500 transition group-open:rotate-180">⌄</span>
      </summary>
      <div className="border-t border-white/6 px-4 py-4">{children}</div>
    </details>
  );
}

function TabbedPlayResearch({
  results,
  selectedIndex,
  onSelect,
  onCompare,
  onAsk,
  finderDate,
  showSelector = true,
}: {
  results: UiAiResult[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onCompare: (id: string) => void;
  onAsk: (query: string) => void;
  finderDate: string;
  showSelector?: boolean;
}) {
  const [activeResearchTab, setActiveResearchTab] = useState<'overview' | 'research' | 'matchup' | 'trends' | 'role' | 'market' | 'risk' | 'how'>('overview');
  const selected = results[Math.min(selectedIndex, Math.max(0, results.length - 1))];
  if (!selected) return null;
  const { prop, eliteResearch: a, deepResearch: d } = selected;
  const source = selected.sourceRecord;
  const isNFL = prop.sport.toUpperCase() === 'NFL';
  const roleContext = source?.roleContext as { requirement?: string; status?: string; confidence?: string; workloadTrend?: string; evidence?: string[]; unavailableEvidence?: string[] } | undefined;
  const opponentContext = source?.opponentContext as { status?: string; evidence?: string[]; unavailableMetrics?: string[] } | undefined;
  const injuryContext = source?.injuryContext as { player?: { availabilityDesignation?: string; sourceStatus?: string; status?: string | null; updatedAt?: string | null }; teammateAbsences?: Array<{ player: string; position?: string | null; availabilityDesignation?: string }>; opponentAbsences?: Array<{ player: string; position?: string | null; availabilityDesignation?: string }>; missingFields?: string[] } | undefined;
  const weatherContext = source?.weatherContext as { venue?: { name?: string } | null; environment?: string; conditions?: string | null; temperature?: { value?: number; unit?: string } | null; wind?: { speed?: number; unit?: string } | null; gusts?: { speed?: number; unit?: string } | null; precipitation?: { amount?: number; unit?: string } | null; sourceStatus?: string; missingFields?: string[] } | undefined;
  const signalPct = a?.signalsAvailable ? Math.round((a.signalAgreement / a.signalsAvailable) * 100) : null;
  const edge = a?.priceEdgePercent ?? selected.deepResearch?.priceEdgePercent ?? null;
  const side = prop.researchSide.toUpperCase();
  const propDiveHref = getResearchHref({ playerId: prop.playerId, opportunityId: prop.id, sport: prop.sport.toLowerCase() === 'nfl' ? 'nfl' : 'mlb', date: finderDate });
  const opposingStarter = prop.homeAway === 'Home' ? prop.startingPitchers?.away : prop.startingPitchers?.home;
  const projectionGap = a?.rawEdge ?? null;
  const lineValue = Number.parseFloat(prop.line);
  const projectionValue = prop.projectedValue;
  const chartMax = Math.max(Number.isFinite(lineValue) ? lineValue : 0, projectionValue || 0, 1);
  const lineLeft = Math.min(96, Math.max(4, ((Number.isFinite(lineValue) ? lineValue : 0) / chartMax) * 92));
  const projectionLeft = Math.min(96, Math.max(4, ((projectionValue || 0) / chartMax) * 92));
  const tabItems = [
    { key: 'overview' as const, label: 'Overview', status: a?.eliteQualified ? 'STRONG' as ResearchSectionStatus : 'NEUTRAL' as ResearchSectionStatus },
    { key: 'research' as const, label: 'Research', status: sectionStatus(selected, 'projection') },
    { key: 'trends' as const, label: 'Trends', status: sectionStatus(selected, 'recent') },
    { key: 'matchup' as const, label: 'Matchup', status: sectionStatus(selected, 'matchup') },
    { key: 'market' as const, label: 'Market', status: sectionStatus(selected, 'market') },
    { key: 'role' as const, label: 'Role', status: sectionStatus(selected, 'role') },
    { key: 'risk' as const, label: 'Risk', status: sectionStatus(selected, 'risk') },
    { key: 'how' as const, label: 'How It Loses', status: sectionStatus(selected, 'how') },
  ];

  const BarMetric = ({ label, value }: { label: string; value: number }) => (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs"><span className="text-slate-500">{label}</span><span className="font-bold text-white">{value < 0 || !Number.isFinite(value) ? 'Unavailable' : `${value}%`}</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-300" style={{ width: `${value < 0 || !Number.isFinite(value) ? 0 : Math.min(100, Math.max(0, value))}%` }} /></div>
    </div>
  );

  const unavailable = <span className="text-slate-500">Unavailable</span>;
  const risks = (d?.howItLoses?.length ? d.howItLoses : selected.riskNotes).slice(0, 4);

  return (
    <div className="overflow-hidden rounded-[1.35rem] border border-emerald-400/20 bg-[#07110d] shadow-[0_18px_80px_rgba(0,0,0,0.35)]">
      {showSelector && <div className="border-b border-white/8 bg-black/20 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">{results.length} Elite Play{results.length === 1 ? '' : 's'}</p>
          <p className="text-xs text-slate-500">No reload · no new research</p>
        </div>
        <div className="scrollbar-hidden mt-3 flex gap-2 overflow-x-auto pb-1">
          {results.slice(0, 15).map((result, index) => (
            <button key={result.prop.id} onClick={() => onSelect(index)} className={`flex shrink-0 items-center gap-2 rounded-2xl px-3 py-2 text-left transition ${index === selectedIndex ? 'bg-emerald-400/15 ring-1 ring-emerald-400/50' : 'bg-white/[0.03] hover:bg-white/[0.06]'}`}>
              <PlayerHeadshot sport={result.prop.sport} playerId={result.prop.playerId} playerName={result.prop.player} teamId={result.prop.teamId} teamName={result.prop.team} size={30} />
              <div className="min-w-0">
                <p className={`text-[10px] font-bold ${index === selectedIndex ? 'text-emerald-300' : 'text-slate-500'}`}>#{index + 1}</p>
                <p className={`max-w-28 truncate text-xs font-semibold ${index === selectedIndex ? 'text-white' : 'text-slate-300'}`}>{result.prop.player}</p>
                <p className="max-w-28 truncate text-[10px] text-slate-500">{result.prop.researchSide} {result.prop.line} {result.prop.propType}</p>
              </div>
            </button>
          ))}
        </div>
      </div>}

      <div className="grid gap-6 p-5 lg:grid-cols-[300px_1fr] lg:p-6">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-white/[0.06] to-transparent">
          <div className="relative flex justify-center pt-2">
            <PlayerHeadshot sport={prop.sport} playerId={prop.playerId} playerName={prop.player} teamId={prop.teamId} teamName={prop.team} size={220} hero className="h-56 w-56 shadow-[0_20px_60px_rgba(0,0,0,0.45)]" />
            {a?.eliteQualified && <span className="absolute right-2 top-2 rounded-full bg-emerald-400 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-slate-950">Elite Pick</span>}
          </div>
          <div className="px-5 pb-5 pt-4 text-center">
            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-emerald-300">#{selectedIndex + 1}</p>
            <h2 className="mt-1 text-2xl font-black uppercase tracking-wide text-white">{prop.player}</h2>
            <div className="mt-1 flex items-center justify-center gap-1.5 text-sm text-slate-400"><TeamLogo teamId={prop.teamId} teamName={prop.team} size={14} />{prop.team}{prop.opponent ? ` vs ${prop.opponent}` : ''}</div>
            <div className="mx-auto mt-5 max-w-[220px] border-t border-white/8 pt-4">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">{prop.propType}</p>
              <p className="mt-1 text-3xl font-black text-white">{side} {prop.line}</p>
              <p className="mt-2 text-sm text-slate-400">{prop.sportsbookName ?? 'Best book'} <span className="font-bold text-emerald-300">{odds(prop.researchSide === 'Under' ? prop.underOdds : prop.overOdds)}</span></p>
            </div>
          </div>
        </div>

        <div className="min-w-0 space-y-5">
          <div className="flex flex-wrap items-end gap-8">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-500">True Probability</p>
              <p className="mt-1 text-6xl font-black leading-none text-emerald-300">{pct(a?.trueProbability)}</p>
            </div>
            <div className="flex gap-6 pb-1">
              <div><p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Edge</p><p className={`mt-0.5 text-xl font-bold ${(edge ?? 0) > 0 ? 'text-emerald-300' : 'text-slate-400'}`}>{pct(edge)}</p></div>
              <div><p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">DeepSide Projection</p><p className="mt-0.5 text-xl font-bold text-white">{num(projectionValue, 2)}</p></div>
              <div><p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">EV</p><p className={`mt-0.5 text-xl font-bold ${(a?.evPercent ?? 0) > 0 ? 'text-emerald-300' : 'text-slate-400'}`}>{pct(a?.evPercent)}</p></div>
            </div>
          </div>

          <div className="grid grid-cols-4 divide-x divide-white/8 border-y border-white/8 py-3 text-center">
            <div><p className="text-[9px] uppercase tracking-[0.16em] text-slate-500">Research</p><p className="mt-1 text-lg font-black text-white">{a?.researchScore ?? selected.matchScore}</p></div>
            <div><p className="text-[9px] uppercase tracking-[0.16em] text-slate-500">Signals</p><p className="mt-1 text-lg font-black text-emerald-300">{signalPct == null ? '—' : `${signalPct}%`}</p></div>
            <div><p className="text-[9px] uppercase tracking-[0.16em] text-slate-500">Data</p><p className="mt-1 text-lg font-black text-white">{a?.dataQuality ?? '—'}</p></div>
            <div><p className="text-[9px] uppercase tracking-[0.16em] text-slate-500">Trap</p><p className={`mt-1 text-lg font-black ${(a?.trapRisk ?? 0) <= 25 ? 'text-emerald-300' : 'text-amber-300'}`}>{a?.trapRisk ?? '—'}</p></div>
          </div>

          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-300">Why DeepSide Found It</p>
            <div className="mt-3"><SignalRows result={selected} onJump={setActiveResearchTab} /></div>
          </div>

          <div className="rounded-2xl border border-white/8 bg-black/20 p-2">
            <div className="flex gap-1 overflow-x-auto pb-1">
              {tabItems.map((tab) => (
                <button key={tab.key} onClick={() => setActiveResearchTab(tab.key)} className={`shrink-0 rounded-xl px-3 py-2 text-left text-xs transition ${activeResearchTab === tab.key ? 'bg-emerald-400 text-slate-950' : 'bg-white/5 text-slate-300 hover:bg-white/8'}`}>
                  <span className="block font-bold">{tab.label}</span>
                  <span className={`mt-1 inline-block rounded-full border px-1.5 py-0.5 text-[8px] ${activeResearchTab === tab.key ? 'border-slate-950/20 text-slate-950' : SECTION_STATUS_STYLES[tab.status]}`}>{tab.status}</span>
                </button>
              ))}
            </div>

            <div className="mt-2 rounded-2xl border border-white/8 bg-[#061019] p-4">
              {activeResearchTab === 'overview' && (
                <div className="space-y-5">
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Why is this interesting?</p>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Projection vs Line</p>
                      <p className="mt-1 text-sm leading-6 text-slate-300">DeepSide projects <strong className="text-white">{num(projectionValue, 2)}</strong> against a line of <strong className="text-white">{side} {prop.line}</strong>{projectionGap != null ? `, a signed edge of ${num(projectionGap, 2)}` : ''}.</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Recent Form vs Baseline</p>
                      <p className="mt-1 text-sm leading-6 text-slate-300">L10 is <strong className="text-white">{prop.hitRates.last10 < 0 ? 'Unavailable' : `${prop.hitRates.last10}%`}</strong> versus a season rate of <strong className="text-white">{prop.hitRates.season < 0 ? 'Unavailable' : `${prop.hitRates.season}%`}</strong>.</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Top Matchup Signal</p>
                      <p className="mt-1 text-sm leading-6 text-slate-300">{selected.matchReasons.find((r) => /matchup|opponent/i.test(r)) ?? selected.matchReasons[0] ?? 'Unavailable'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.16em] text-slate-500">Top Risk</p>
                      <p className="mt-1 text-sm leading-6 text-slate-300">{risks[0] ?? 'Unavailable'}</p>
                    </div>
                  </div>
                </div>
              )}

              {activeResearchTab === 'research' && (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <MetricTile label="Sportsbook Line" value={`${side} ${prop.line}`} />
                    <MetricTile label="DeepSide Projection" value={num(projectionValue, 2)} tone="good" />
                    <MetricTile label="Projection Difference" value={num(projectionGap, 2)} />
                    <MetricTile label="Projection Reliability" value={String((a as unknown as { projectionReliability?: string })?.projectionReliability ?? 'Unavailable')} tone="muted" />
                    <MetricTile label="Model Probability" value={pct(a?.modelProbability)} />
                    <MetricTile label="Historical Hit Rate" value={pct(a?.historicalHitRatePercent)} />
                    <MetricTile label="True Probability" value={pct(a?.trueProbability)} tone="good" />
                    <MetricTile label="Break-Even / EV" value={`${pct(a?.breakEvenProbability)} / ${pct(a?.evPercent)}`} />
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
                    <div className="mb-3 flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">Line vs DeepSide Projection</p><p className="text-xs text-slate-500">Same scale</p></div>
                    <div className="relative h-16 rounded-xl border border-white/8 bg-white/5">
                      <div className="absolute left-4 right-4 top-1/2 h-px bg-slate-600" />
                      <div className="absolute top-4 h-8 w-px bg-amber-300" style={{ left: `${lineLeft}%` }}><span className="absolute -left-8 -top-5 text-[10px] text-amber-200">Line {prop.line}</span></div>
                      <div className="absolute top-4 h-8 w-px bg-emerald-300" style={{ left: `${projectionLeft}%` }}><span className="absolute -left-10 top-9 text-[10px] text-emerald-200">Projection {num(projectionValue, 2)}</span></div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">Projection Rundown</p><p className="mt-2 text-sm leading-6 text-slate-300">The model view combines the sportsbook threshold, DeepSide projection, distribution probability, historical calibration, and current price. The strongest available support here is {a?.rawEdge != null ? `a ${num(a.rawEdge, 2)} edge in the recommended direction` : 'unavailable projection separation'} with {a?.trueProbability != null ? `${pct(a.trueProbability)} true probability` : 'unavailable true probability'}.</p></div>
                </div>
              )}

              {activeResearchTab === 'matchup' && (
                isNFL ? <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <MetricTile label="Player / Opponent" value={`${prop.player} vs ${prop.opponent || 'Unavailable'}`} />
                    <MetricTile label="Matchup Status" value={opponentContext?.status ?? 'Unavailable'} tone="muted" />
                    <MetricTile label="Venue Split" value={`${pct(source?.homeHitRate)} home / ${pct(source?.awayHitRate)} away`} />
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/5 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">Available Evidence</p><div className="mt-2 space-y-1 text-sm text-slate-300">{(opponentContext?.evidence?.length ? opponentContext.evidence : [`Scheduled opponent: ${prop.opponent || 'Unavailable'}`]).map((item) => <p key={item}>• {item}</p>)}</div></div>
                    <div className="rounded-2xl border border-amber-400/15 bg-amber-400/5 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">Missing Matchup Evidence</p><div className="mt-2 space-y-1 text-sm text-slate-300">{(opponentContext?.unavailableMetrics ?? ['defensive matchup', 'injuries', 'weather', 'game script']).map((item) => <p key={item}>• {item}: Unavailable</p>)}</div></div>
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-white/8 bg-black/20 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Availability</p><div className="mt-2 space-y-1 text-sm text-slate-300"><p>Player: {injuryContext?.player?.availabilityDesignation ?? 'Unknown'} ({injuryContext?.player?.sourceStatus ?? 'Unavailable'})</p><p>Status: {injuryContext?.player?.status ?? 'Unavailable'}</p><p>Updated: {injuryContext?.player?.updatedAt ?? 'Unavailable'}</p>{(injuryContext?.teammateAbsences ?? []).slice(0, 3).map((entry) => <p key={entry.player}>• Teammate: {entry.player} {entry.position ?? ''} ({entry.availabilityDesignation ?? 'Unknown'})</p>)}{(injuryContext?.opponentAbsences ?? []).slice(0, 3).map((entry) => <p key={entry.player}>• Opponent: {entry.player} {entry.position ?? ''} ({entry.availabilityDesignation ?? 'Unknown'})</p>)}</div></div>
                    <div className="rounded-2xl border border-white/8 bg-black/20 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Game Environment</p><div className="mt-2 space-y-1 text-sm text-slate-300"><p>Venue: {weatherContext?.venue?.name ?? 'Unavailable'}</p><p>Environment: {weatherContext?.environment ?? 'Unknown'} ({weatherContext?.sourceStatus ?? 'Unavailable'})</p><p>Conditions: {weatherContext?.conditions ?? 'Unavailable'}</p><p>Temperature / Wind: {weatherContext?.temperature ? `${weatherContext.temperature.value}${weatherContext.temperature.unit ?? ''}` : 'Unavailable'} / {weatherContext?.wind ? `${weatherContext.wind.speed} ${weatherContext.wind.unit ?? ''}` : 'Unavailable'}</p><p>Gusts / Precipitation: {weatherContext?.gusts ? `${weatherContext.gusts.speed} ${weatherContext.gusts.unit ?? ''}` : 'Unavailable'} / {weatherContext?.precipitation ? `${weatherContext.precipitation.amount} ${weatherContext.precipitation.unit ?? ''}` : 'Unavailable'}</p></div></div>
                  </div>
                </div> : <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <MetricTile label="Player vs Opponent" value={`${prop.player} vs ${prop.opponent || 'Unavailable'}`} />
                    <MetricTile label="Opposing Starter" value={opposingStarter?.name ?? 'Unavailable'} />
                    <MetricTile label="Pitcher Handedness" value={opposingStarter?.hand ?? 'Unavailable'} tone="muted" />
                    <MetricTile label="Batter Handedness" value="Unavailable" tone="muted" />
                    <MetricTile label="Ballpark" value={prop.stadium?.name ?? 'Unavailable'} />
                    <MetricTile label="Weather / Wind" value={prop.weather ? `${prop.weather.temperature}, ${prop.weather.windSpeed} ${prop.weather.windDirection}` : 'Unavailable'} tone="muted" />
                    <MetricTile label="Bullpen Context" value={prop.bullpen ? 'Available' : 'Unavailable'} tone={prop.bullpen ? 'default' : 'muted'} />
                    <MetricTile label="Lineup Position" value={prop.projectedBattingOrder ? `#${prop.projectedBattingOrder}` : 'Unavailable'} />
                    <MetricTile label="Expected PA" value={prop.projectedPlateAppearances ? num(prop.projectedPlateAppearances, 1) : 'Unavailable'} />
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/5 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">Key Advantages</p><div className="mt-2 space-y-1 text-sm text-slate-300">{selected.matchReasons.slice(0, 3).map((reason) => <p key={reason}>• {reason}</p>)}</div></div>
                    <div className="rounded-2xl border border-amber-400/15 bg-amber-400/5 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">Matchup Concerns</p><div className="mt-2 space-y-1 text-sm text-slate-300">{['Pitcher recent form', 'Batter handedness splits', 'Expected bullpen exposure'].map((item) => <p key={item}>• {item}: {unavailable}</p>)}</div></div>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">Matchup Rundown</p><p className="mt-2 text-sm leading-6 text-slate-300">{prop.player} faces {prop.opponent || 'an unavailable opponent'} with {opposingStarter?.name ? `${opposingStarter.name} listed as the opposing starter` : 'opposing starter data unavailable'}. Opportunity support is {prop.projectedPlateAppearances ? `${num(prop.projectedPlateAppearances, 1)} projected plate appearances` : 'unavailable'}, and unsupported matchup sources remain explicitly unavailable rather than inferred.</p></div>
                </div>
              )}

              {activeResearchTab === 'trends' && (
                <div className="space-y-4">
                  <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
                    <div className="space-y-3 rounded-2xl border border-white/8 bg-black/20 p-4"><BarMetric label="L5 hit rate" value={prop.hitRates.last5} /><BarMetric label="L10 hit rate" value={prop.hitRates.last10} /><BarMetric label="L20 hit rate" value={prop.hitRates.last20} /><BarMetric label="Season hit rate" value={prop.hitRates.season} /></div>
                    <div className="grid gap-2"><MetricTile label="Recent Trend" value={prop.hitRates.last5 > prop.hitRates.season + 10 ? 'Improving' : prop.hitRates.last5 < prop.hitRates.season - 10 ? 'Declining' : 'Stable'} /><MetricTile label="Long-Term Baseline" value={`${prop.hitRates.season}% season`} /><MetricTile label="Sample / Average" value={isNFL ? `${source?.sampleSize ?? 'Unavailable'} / ${num(source?.average, 2)}` : 'Unavailable'} /><MetricTile label="Median / Std Dev" value={isNFL ? `${num(source?.median, 2)} / ${num(source?.standardDeviation, 2)}` : 'Unavailable'} /><MetricTile label="Outlier Dependence" value={String(source?.outlierDependencePercent ?? 'Unavailable')} tone="muted" /></div>
                  </div>
                  <div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">Recent Form Rundown</p><p className="mt-2 text-sm leading-6 text-slate-300">Recent form is {prop.hitRates.last5 > prop.hitRates.season + 10 ? 'running ahead of' : prop.hitRates.last5 < prop.hitRates.season - 10 ? 'below' : 'roughly aligned with'} the season baseline. L5 is {prop.hitRates.last5}% versus a {prop.hitRates.season}% season rate, with L10 at {prop.hitRates.last10}%.</p></div>
                </div>
              )}

              {activeResearchTab === 'role' && (
                isNFL ? <div className="space-y-4"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><MetricTile label="Role Requirement" value={roleContext?.requirement ?? 'Unavailable'} /><MetricTile label="Role Status" value={roleContext?.status ?? 'Unavailable'} /><MetricTile label="Role Confidence" value={roleContext?.confidence ?? 'Unavailable'} /><MetricTile label="Workload Trend" value={roleContext?.workloadTrend ?? 'Unavailable'} /></div><div className="grid gap-3 md:grid-cols-2"><div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/5 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">Workload Evidence</p><div className="mt-2 space-y-1 text-sm text-slate-300">{(roleContext?.evidence ?? []).map((item) => <p key={item}>• {item}</p>)}</div></div><div className="rounded-2xl border border-amber-400/15 bg-amber-400/5 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">Unavailable Role Evidence</p><div className="mt-2 space-y-1 text-sm text-slate-300">{(roleContext?.unavailableEvidence ?? []).map((item) => <p key={item}>• {item}</p>)}</div></div></div></div>
                  : <div className="space-y-4"><div className="grid gap-3 md:grid-cols-3"><MetricTile label="Expected PA / Workload" value={prop.projectedPlateAppearances ? num(prop.projectedPlateAppearances, 1) : 'Unavailable'} /><MetricTile label="Lineup Position" value={prop.projectedBattingOrder ? `#${prop.projectedBattingOrder}` : 'Unavailable'} /><MetricTile label="Starter / Role" value="Unavailable" tone="muted" /><MetricTile label="Pitcher Workload" value={prop.propType.toLowerCase().includes('strikeout') ? num(prop.projectedValue, 2) : 'Unavailable'} tone="muted" /><MetricTile label="Recent PA" value="Unavailable" tone="muted" /><MetricTile label="Injury Status" value="Unavailable" tone="muted" /></div><div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">Opportunity Rundown</p><p className="mt-2 text-sm leading-6 text-slate-300">Opportunity support is based only on connected fields. {prop.projectedPlateAppearances ? `DeepSide expects approximately ${num(prop.projectedPlateAppearances, 1)} plate appearances.` : 'Expected plate appearances are unavailable for this candidate.'} Missing lineup or injury data is not inferred.</p></div></div>
              )}

              {activeResearchTab === 'market' && (
                <div className="space-y-4"><div className="grid gap-3 lg:grid-cols-2"><div className="rounded-2xl border border-white/8 bg-black/20 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Sportsbook Market Information</p><div className="mt-3 grid gap-2 sm:grid-cols-2"><MetricTile label="Sportsbook" value={prop.sportsbookName ?? 'Unavailable'} /><MetricTile label="Current Line" value={`${side} ${prop.line}`} /><MetricTile label="Current Odds" value={odds(prop.researchSide === 'Under' ? prop.underOdds : prop.overOdds)} /><MetricTile label="Price Freshness" value={a?.priceFreshness ?? 'Unavailable'} /></div></div><div className="rounded-2xl border border-emerald-400/15 bg-emerald-400/5 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">DeepSide Model Information</p><div className="mt-3 grid gap-2 sm:grid-cols-2"><MetricTile label="True Probability" value={pct(a?.trueProbability)} /><MetricTile label="Break-Even" value={pct(a?.breakEvenProbability)} /><MetricTile label="Probability Edge" value={pct(a?.priceEdgePercent)} /><MetricTile label="EV" value={pct(a?.evPercent)} /></div></div></div><div className="grid gap-3 md:grid-cols-3"><MetricTile label="Cross-Book Threshold" value="Unavailable" tone="muted" /><MetricTile label="Best Alternate Line" value={d?.bestAlternateLine ? `${d.bestAlternateLine.side.toUpperCase()} ${d.bestAlternateLine.line} · ${d.bestAlternateLine.bestBook ?? 'Book unavailable'}` : 'Unavailable'} /><MetricTile label="Market Movement" value="Unavailable" tone="muted" /></div><div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-emerald-300">Market Rundown</p><p className="mt-2 text-sm leading-6 text-slate-300">The price is {a?.priceCurrent ? 'current enough for value evaluation' : 'not current enough for official current-EV claims'}. Value qualification is {a?.valueQualified ? 'present' : 'not present'}, based on DeepSide probability versus break-even, not sportsbook consensus.</p></div></div>
              )}

              {activeResearchTab === 'risk' && (
                <div className="space-y-4"><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4"><MetricTile label="Trap Risk" value={String(a?.trapRisk ?? 'Unavailable')} tone={(a?.trapRisk ?? 99) <= 25 ? 'good' : 'risk'} /><MetricTile label="Data Quality" value={String(a?.dataQuality ?? 'Unavailable')} /><MetricTile label="Projection Reliability" value={String((a as unknown as { projectionReliability?: string })?.projectionReliability ?? 'Unavailable')} tone="muted" /><MetricTile label="Outlier Dependence" value={String((selected as unknown as { outlierDependencePercent?: number | null }).outlierDependencePercent ?? 'Unavailable')} tone="muted" /></div><div className="rounded-2xl border border-rose-400/15 bg-rose-400/5 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-rose-300">What DeepSide Is Worried About</p><div className="mt-2 space-y-2 text-sm text-slate-300">{risks.map((risk) => <p key={risk}>• {risk}</p>)}</div></div></div>
              )}

              {activeResearchTab === 'how' && (
                <div className="space-y-4"><div className="rounded-2xl border border-rose-400/15 bg-rose-400/5 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-rose-300">Primary Failure Path</p><p className="mt-2 text-sm leading-6 text-slate-300">{risks[0] ?? 'Unavailable'}</p></div><div className="grid gap-3 md:grid-cols-2"><div className="rounded-2xl border border-amber-400/15 bg-amber-400/5 p-4"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-amber-300">Secondary Risks</p><div className="mt-2 space-y-1 text-sm text-slate-300">{risks.slice(1, 4).map((risk) => <p key={risk}>• {risk}</p>)}</div></div><div className="rounded-2xl border border-white/8 bg-white/[0.03] p-4"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-300">What To Watch</p><div className="mt-2 space-y-1 text-sm text-slate-300"><p>• Price freshness: {a?.priceFreshness ?? 'Unavailable'}</p><p>• Projection edge: {projectionGap == null ? 'Unavailable' : num(projectionGap, 2)}</p><p>• Trap risk: {a?.trapRisk ?? 'Unavailable'}</p></div></div></div></div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-white/8 pt-4">
            <Link href={propDiveHref} className="rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-2 text-xs font-bold text-emerald-300 hover:bg-emerald-400/15">Open in Prop Dive</Link>
            <button onClick={() => onCompare(prop.id)} className="rounded-xl border border-white/10 px-4 py-2 text-xs font-bold text-slate-300 hover:text-white">Compare</button>
            <button onClick={() => onAsk(`Why is ${prop.player} ranked #${selectedIndex + 1}?`)} className="rounded-xl border border-teal-400/30 bg-teal-400/10 px-4 py-2 text-xs font-bold text-teal-300 hover:bg-teal-400/15">Ask DeepSide AI</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

/** Dev-only marker proving which build the browser actually loaded. Bump when verifying a fix. */
const AI_BUILD_MARKER = "FIX-2245";

/** Dev-only: /ai?health=1 renders this and nothing else — no storage, no fetch, no child components.
 * If this renders but normal /ai does not, the fault is in the page tree, not the route/server/build. */
function AiHealthCard() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#050807]">
      <div className="rounded-2xl border border-[#39f27f]/40 bg-[#39f27f]/5 px-10 py-8 text-center">
        <p className="text-2xl font-extrabold text-[#39f27f]">AI ROUTE IS ALIVE</p>
        <p className="mt-2 text-sm text-slate-400">AI BUILD: {AI_BUILD_MARKER}</p>
      </div>
    </div>
  );
}

export default function AiFinderPage() {
  return (
    <Suspense fallback={null}>
      <AiFinderPageGate />
    </Suspense>
  );
}

function AiFinderPageGate() {
  const searchParams = useSearchParams();
  if (searchParams.get("health") === "1") return <AiHealthCard />;
  return <AiFinderPageContent />;
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
  const [results, setResults] = useState<UiAiResult[]>([]);
  const [closestMisses, setClosestMisses] = useState<UiAiResult[]>([]);
  const [selectedPlayIndex, setSelectedPlayIndex] = useState<number | null>(null);
  const [totalMatched, setTotalMatched] = useState(0);
  const [showCount, setShowCount] = useState(15);
  const [conversation, setConversation] = useState<Array<{ role: "user" | "ai"; text: string }>>([]);
  const [toolTrace, setToolTrace] = useState<AgentToolTrace[]>([]);
  const [agentMeta, setAgentMeta] = useState<Record<string, unknown> | null>(null);
  const [researchSessionId, setResearchSessionId] = useState<string | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [refreshApprovalOffer, setRefreshApprovalOffer] = useState<RefreshApprovalOffer | null>(null);
  const [selectedRefreshBudget, setSelectedRefreshBudget] = useState(60);
  const [customRefreshBudget, setCustomRefreshBudget] = useState('');
  const [showGameSelection, setShowGameSelection] = useState(false);
  const [manualSelectedGameIds, setManualSelectedGameIds] = useState<string[] | null>(null);
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
  // Dev-only: how far page boot got, so a stuck/blank page can be diagnosed without a debugger.
  const [bootCheckpoint, setBootCheckpoint] = useState('AI_BOOT_2_COMPONENT');

  useEffect(() => {
    setBootCheckpoint((prev) => (prev === 'AI_BOOT_2_COMPONENT' ? 'AI_BOOT_4_UI_READY' : prev));
  }, []);

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
        const saved = JSON.parse(raw) as Partial<PersistedAIFinderSession>;
        // Unversioned or mismatched-version storage predates the current shape — never partially
        // trust it (a field that used to mean one thing could now break a different assumption).
        if (saved.version !== AI_FINDER_SESSION_VERSION) {
          window.sessionStorage.removeItem(AI_FINDER_SESSION_KEY);
          setSessionRestored(true);
          return;
        }
        // Each field is restored independently: if one is malformed, the rest still apply and the
        // page still loads — a single bad field can never take down the whole restore.
        const restore = (fn: () => void) => { try { fn(); } catch { /* ignore this field, keep going */ } };
        restore(() => { if (saved.sport === 'MLB' || saved.sport === 'NFL') setFinderSport(saved.sport); });
        restore(() => { if (saved.date) setFinderDate(resolveSlateDate(saved.date)); });
        restore(() => { if (saved.mode) setMode(saved.mode); });
        restore(() => setQuery(saved.query ?? ''));
        restore(() => setCriteria(saved.criteria ?? null));
        const restoredResults = Array.isArray(saved.results) ? saved.results.filter(hasAllowedOfficialPrice) : [];
        restore(() => setResults(restoredResults));
        restore(() => setTotalMatched(typeof saved.totalMatched === 'number' ? saved.totalMatched : 0));
        restore(() => setFinderStatus(restoredResults.length > 0 ? 'RESULTS' : saved.finderStatus ?? 'IDLE'));
        restore(() => setShowCount(typeof saved.showCount === 'number' ? saved.showCount : 15));
        restore(() => setConversation(Array.isArray(saved.conversation) ? saved.conversation : []));
        restore(() => setToolTrace(Array.isArray(saved.toolTrace) ? saved.toolTrace : []));
        restore(() => setAgentMeta(saved.agentMeta ?? null));
        restore(() => setResearchSessionId(typeof saved.researchSessionId === 'string' ? saved.researchSessionId : null));
        restore(() => setSelectedIds(new Set(Array.isArray(saved.selectedIds) ? saved.selectedIds : [])));
        restore(() => setDeepSummary(saved.deepSummary ?? null));
        restore(() => setDeepSummarySport(saved.deepSummarySport ?? null));
        restore(() => setMinFinderScore(saved.filters?.minFinderScore ?? 0));
        restore(() => setMinEv(saved.filters?.minEv ?? null));
        restore(() => setMinBooks(saved.filters?.minBooks ?? 0));
        restore(() => setFinderSortBy(saved.filters?.finderSortBy ?? 'score'));
        restore(() => setFinderPlayerFilter(saved.filters?.finderPlayerFilter ?? ''));
        restore(() => setFinderTeamFilter(saved.filters?.finderTeamFilter ?? 'All'));
        restore(() => setFinderGameFilter(saved.filters?.finderGameFilter ?? 'All'));
        restore(() => setFinderMarketFilter(saved.filters?.finderMarketFilter ?? 'All'));
        restore(() => setFinderSideFilter(saved.filters?.finderSideFilter ?? 'All'));
        restore(() => setFinderBookFilter(saved.filters?.finderBookFilter ?? 'All'));
        restore(() => setFinderAltFilter(saved.filters?.finderAltFilter ?? 'All'));
      }
    } catch {
      window.sessionStorage.removeItem(AI_FINDER_SESSION_KEY);
    } finally {
      setSessionRestored(true);
      setBootCheckpoint('AI_BOOT_5_SESSION_READY');
    }
  }, []);

  useEffect(() => {
    if (!sessionRestored) return;
    if (sessionClearedRef.current) {
      window.sessionStorage.removeItem(AI_FINDER_SESSION_KEY);
      return;
    }
    const session: PersistedAIFinderSession = {
      version: AI_FINDER_SESSION_VERSION,
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
      toolTrace,
      agentMeta,
      researchSessionId,
      selectedIds: [...selectedIds],
      // Never persist hundreds of raw candidates: only the (naturally small) Elite-qualified subset can
      // ever be displayed by this grid, so that's all storage needs to survive a reload.
      deepSummary: deepSummary ? { ...deepSummary, credits: null, results: deepSummary.results.filter((r) => analyzePickCandidate(finderResultToEliteCandidate(r)).eliteQualified).slice(0, 200) } : null,
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
  }, [agentMeta, conversation, criteria, deepSummary, deepSummarySport, finderAltFilter, finderBookFilter, finderDate, finderGameFilter, finderMarketFilter, finderPlayerFilter, finderSideFilter, finderSortBy, finderSport, finderStatus, finderTeamFilter, minBooks, minEv, minFinderScore, mode, query, researchSessionId, results, selectedIds, sessionRestored, showCount, toolTrace, totalMatched]);

  useEffect(() => {
    setSelectedPlayIndex(null);
  }, [results.length]);

  // Re-fetching automatically on date change would silently refresh provider data behind the user's
  // back; Finder only loads when the user explicitly starts Quick Find or Deep Search.
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

  function presentNFLResults(summary: FinderRunSummary) {
    const candidates = ((summary as NFLFinderSummary).nflCandidates ?? [])
      .map(nflCandidateToUiResult)
      .filter((result): result is UiAiResult => result != null)
      .sort((a, b) => b.matchScore - a.matchScore);
    const structured = candidates.filter((result) => !result.closestMiss).slice(0, 15);
    setResults(structured);
    setClosestMisses(candidates.filter((result) => result.closestMiss).slice(0, 5));
    setTotalMatched(structured.length);
    setFinderStatus(structured.length > 0 ? 'RESULTS' : summary.slateComplete ? 'SLATE_COMPLETE' : summary.propsAnalyzed === 0 ? 'SPORTSBOOK_UNAVAILABLE' : 'NO_ELITE_RESULTS');
  }

  /** Deep Search always calls through (the server route itself is cache-first, so repeats cost nothing extra). */
  async function runDeepSearch() {
    const summary = await fetchDeepSearch(finderDate, finderSport);
    if (summary && finderSport === 'NFL') presentNFLResults(summary);
  }

  /** Quick Find reuses whatever is already loaded for this exact date; only fetches if nothing is cached yet. */
  async function runQuickFind() {
    const summary = deepSummarySport === finderSport && deepSummary?.slateDate === finderDate
      ? deepSummary
      : await fetchDeepSearch(finderDate, finderSport);
    if (summary && finderSport === 'NFL') presentNFLResults(summary);
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
      if (result.bestBook?.odds == null || result.bestBook.odds < -900) return false;
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
  // The OpenAI agent orchestrates the research server-side; the deterministic Elite Filter
  // still decides qualification, and results render through the existing DeepSide cards.
  async function runSearch(q: string, approval: RefreshApprovalOffer | null = null, appendUser = true) {
    if (!q.trim()) return;
    sessionClearedRef.current = false;
    const trimmed = q.trim();
    setIsSearching(true);
    setLoadingStep(0);
    setShowCount(15);
    setSelectedIds(new Set());

    const lastConversationEntry = conversation[conversation.length - 1];
    const sameBlockedRequest = appendUser
      && ['SPORTSBOOK_DATA_REQUIRED', 'EVENT_LIST_REQUIRED'].includes(finderStatus)
      && lastConversationEntry?.role === 'user'
      && lastConversationEntry.text === trimmed;
    const shouldAppendUser = appendUser && !sameBlockedRequest;
    const history: ConversationEntry[] = shouldAppendUser ? [...conversation, { role: "user", text: trimmed }] : conversation;
    if (shouldAppendUser) {
      setConversation(history);
      setRecentSearches((prev) => [trimmed, ...prev.filter((s) => s !== trimmed)].slice(0, 5));
    }
    setRestrictionMessage("");
    setAgentError(null);

    let payload: AgentChatResponse;
    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: history.map((entry) => ({ role: entry.role === "ai" ? "assistant" : "user", content: entry.text })),
          researchSessionId,
          refreshApproval: approval,
        }),
      });
      payload = (await response.json()) as AgentChatResponse;
      if (!response.ok) {
        const message = payload.error ?? "The research agent is unavailable.";
        setAgentError(message);
        setRestrictionMessage(message);
        setConversation((prev) => [...prev, { role: "ai", text: message }]);
        setFinderStatus("ERROR");
        setResults([]);
        setTotalMatched(0);
        setIsSearching(false);
        return;
      }
    } catch {
      const message = "Could not reach the research agent.";
      setAgentError(message);
      setConversation((prev) => [...prev, { role: "ai", text: message }]);
      setFinderStatus("ERROR");
      setIsSearching(false);
      return;
    }

    setToolTrace(payload.toolTrace ?? []);
    // Follow-up turns that only read stored memory (get_closest_misses etc.) return no meta —
    // keep showing the last real analysis instead of blanking the panel.
    if (payload.meta) setAgentMeta(payload.meta);
    if (payload.researchSessionId !== undefined) setResearchSessionId(payload.researchSessionId);

    const meta = payload.meta ?? {};
    const toolStatus = String(meta.status ?? '');
    const sport = String(meta.sport ?? "mlb").toUpperCase() === "NFL" ? "NFL" : "MLB";
    const requestDate = typeof meta.date === "string" ? meta.date : finderDate;
    if (requestDate !== finderDate) setFinderDate(requestDate);
    if (sport !== finderSport) setFinderSport(sport);

    if (toolStatus === 'SPORTSBOOK_DATA_REQUIRED' || toolStatus === 'EVENT_LIST_REQUIRED') {
      const preflight = meta.sportsbookPreflight as {
        estimatedCreditCostLow?: number;
        estimatedCreditCostExpected?: number;
        estimatedCreditCostHigh?: number;
        selectedValidationGames?: number;
        researchPriorityGames?: RefreshApprovalOffer['researchPriorityGames'];
        games?: RefreshApprovalOffer['slateGames'];
      } | undefined;
      const eventListUnavailable = toolStatus === 'EVENT_LIST_REQUIRED';
      const estimatedHigh = eventListUnavailable ? null : preflight?.estimatedCreditCostHigh ?? null;
      const priorityGames = preflight?.researchPriorityGames ?? [];
      setRefreshApprovalOffer({
        sport: sport.toLowerCase() as 'mlb' | 'nfl',
        date: requestDate,
        maxCredits: estimatedHigh ?? 0,
        maxGames: Number(preflight?.selectedValidationGames ?? 0),
        estimatedLow: eventListUnavailable ? null : preflight?.estimatedCreditCostLow ?? null,
        estimatedExpected: eventListUnavailable ? null : preflight?.estimatedCreditCostExpected ?? null,
        estimatedHigh,
        currentCredits: Number((meta.oddsSpend as { creditsBefore?: number | null } | undefined)?.creditsBefore ?? NaN) || null,
        researchPriorityGames: priorityGames,
        slateGames: preflight?.games ?? [],
      });
      setManualSelectedGameIds(null);
      setFinderStatus(toolStatus === 'EVENT_LIST_REQUIRED' ? 'EVENT_LIST_REQUIRED' : 'SPORTSBOOK_DATA_REQUIRED');
      setResults([]);
      setTotalMatched(0);
      // Blocked sportsbook states render as a system card, not a repeated assistant paragraph.
      setIsSearching(false);
      return;
    }
    setConversation((prev) => [...prev, { role: "ai", text: payload.reply }]);
    setRefreshApprovalOffer(null);

    if ((payload.results ?? []).length > 0) {
      const structuredResults = (payload.results ?? []).filter((record) => record.eliteQualified && record.odds != null && record.odds >= -900).slice(0, 15).map((record) => recordToUiResult(record, sport));
      setTotalMatched(structuredResults.length);
      setResults(structuredResults);
      setClosestMisses([]);
      setFinderStatus(structuredResults.length > 0 ? 'RESULTS' : 'NO_ELITE_RESULTS');
      setIsSearching(false);
      return;
    }

    setClosestMisses((payload.closestMisses ?? []).slice(0, 5).map((record) => closestMissToUiResult(record, sport)));

    // Cache-first: reuses the slate the agent already loaded, so returning here costs no credits.
    let summary = deepSummarySport === sport && deepSummary?.slateDate === requestDate ? deepSummary : null;
    if (!summary) summary = await fetchDeepSearch(requestDate, sport);

    const qualifiedIds = new Set((payload.results ?? []).map((row) => row.candidateId));
    const matched = (summary?.results ?? [])
      .filter((candidate) => qualifiedIds.has(candidate.id))
      .filter((candidate) => candidate.bestBook?.odds != null && candidate.bestBook.odds >= -900)
      .map((candidate) => ({ candidate, analysis: analyzePickCandidate(finderResultToEliteCandidate(candidate)) }))
      .filter(({ analysis }) => analysis.eliteQualified);

    setTotalMatched(matched.length);
    setResults(matched.map(({ candidate, analysis }) => ({
      prop: finderResultToListItem(candidate),
      eliteResearch: analysis,
      deepResearch: buildDeepResearchCard(candidate, analysis),
      matchScore: analysis.researchScore,
      riskLevel: analysis.trapRisk <= 15 ? "LOW" : analysis.trapRisk <= 25 ? "MEDIUM" : "HIGH",
      matchReasons: analysis.whyQualified,
      riskNotes: analysis.riskFactors.slice(0, 2),
      aiReason: candidate.signals[0] ?? "Qualified by the Elite Research Filter.",
    } satisfies AiResult)));

    const propsFound = Number(meta.propsFound ?? summary?.propsAnalyzed ?? 0);
    setFinderStatus(
      matched.length > 0 ? "RESULTS"
        : summary?.slateComplete ? "SLATE_COMPLETE"
          : propsFound === 0 ? "SPORTSBOOK_UNAVAILABLE"
            : "NO_ELITE_RESULTS",
    );
    setIsSearching(false);
  }

  function handleSubmit() {
    if (query.trim()) runSearch(query);
  }

  function approveRefreshAndAnalyze() {
    if (!refreshApprovalOffer || !query.trim()) return;
    void runSearch(query, refreshApprovalOffer, false);
  }

  function approveWithinBudget() {
    if (!refreshApprovalOffer || !query.trim()) return;
    const budget = Number(customRefreshBudget) > 0 ? Number(customRefreshBudget) : selectedRefreshBudget;
    const fullSlateGames = refreshApprovalOffer.researchPriorityGames.length || refreshApprovalOffer.maxGames;
    const safeGames = safelyResearchableGames(budget, fullSlateGames);
    if (safeGames <= 0) return;
    const selectedGameIds = manualSelectedGameIds ?? refreshApprovalOffer.researchPriorityGames.slice(0, safeGames).map((game) => game.gameId);
    if (selectedGameIds.length === 0) return;
    void runSearch(query, { ...refreshApprovalOffer, maxCredits: budget, maxGames: selectedGameIds.length, selectedGameIds }, false);
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
    if (researchSessionId) {
      fetch('/api/ai/chat', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ researchSessionId }) }).catch(() => {});
    }
    setFinderSport('MLB');
    setFinderDate(todaySlateDate());
    setMode('quick');
    setQuery('');
    setCriteria(null);
    setToolTrace([]);
    setAgentMeta(null);
    setResearchSessionId(null);
    setAgentError(null);
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

  const analysisChips = ([
    ['sport', 'Sport'], ['date', 'Slate'], ['gamesFound', 'Games'],
    ['propsFound', 'Props'], ['booksFound', 'Books'], ['candidatesFound', 'Candidates'], ['eliteFound', 'Elite'],
  ] as const)
    .filter(([key]) => agentMeta?.[key] !== undefined && agentMeta?.[key] !== null)
    .map(([key, label]) => ({ label, value: String(agentMeta?.[key]) }));

  // Dev-only provider-spend diagnostic — never shown in production.
  const oddsSpend = agentMeta?.oddsSpend as { creditsSpent: number; paidRequestsMade: number; cacheHits: number; staleCacheHits: number; cacheMisses: number } | null | undefined;
  const oddsSpendLabel = process.env.NODE_ENV !== 'production' && oddsSpend
    ? oddsSpend.paidRequestsMade > 0
      ? `Odds API: PAID • ${oddsSpend.creditsSpent} credits (${oddsSpend.paidRequestsMade} requests)`
      : `Odds API: CACHE • 0 credits (${oddsSpend.cacheHits} fresh, ${oddsSpend.staleCacheHits} stale, ${oddsSpend.cacheMisses} missing)`
    : null;

  return (
    <div className="flex h-screen overflow-hidden bg-[#060d18] text-white">
      <AppSidebar currentPath="/ai" footer={sidebarFooter} />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* ── Top nav ── */}
        <header className="flex shrink-0 items-center gap-3 border-b border-white/5 bg-[#0b1522] px-4 py-2.5">
            <div className="flex max-w-sm flex-1 items-center gap-2 rounded-xl border border-white/8 bg-white/5 px-3 py-1.5 text-sm text-slate-600">
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <span>DeepSide AI</span>
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

              {process.env.NODE_ENV !== "production" && (
                <p className="text-center text-[10px] font-mono text-[#39f27f]/70">
                  AI BUILD: {AI_BUILD_MARKER} • {bootCheckpoint}
                </p>
              )}

              {/* Prop Finder hero */}
              {conversation.length === 0 && !isSearching && (
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
                          <p className="text-xs text-slate-500">{finderSport === 'MLB' ? 'Analyzes the cached MLB slate using real MLB Stats API and Odds API data.' : 'Analyzes NFL sportsbook props with ESPN player history, workload context, projections, and the Elite Filter.'}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={runQuickFind} disabled={deepLoading} title="Reuses already-cached results for this slate — no new provider calls" className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-bold text-white transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40">⚡ Quick Find</button>
                          <button onClick={runDeepSearch} disabled={deepLoading} className="rounded-xl bg-[#39f27f] px-4 py-2 text-sm font-bold text-[#041008] transition hover:bg-[#63f99a] disabled:cursor-not-allowed disabled:opacity-50">{deepLoading ? "Analyzing…" : "🔍 Deep Search"}</button>
                        </div>
                      </div>
                      {deepError && <p className="mt-3 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-sm text-amber-200">Sportsbook data unavailable. No unsupported or fabricated NFL candidates were shown.</p>}
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

                          {finderSport === 'MLB' && filteredDeepResults.length === 0 && visibleDeepSummary.propsAnalyzed > 0 && <p className="text-sm text-slate-400">No Elite picks found. Candidates must pass the full research filter before they can be recommended.</p>}
                          {finderSport === 'MLB' && filteredDeepResults.length === 0 && visibleDeepSummary.slateComplete && <p className="text-sm text-amber-200">Every game on {visibleDeepSummary.slateDate} has already finished, so sportsbooks no longer offer props. Try the next slate.</p>}
                          {finderSport === 'MLB' && filteredDeepResults.length === 0 && !visibleDeepSummary.slateComplete && visibleDeepSummary.propsAnalyzed === 0 && <p className="text-sm text-amber-200">Sportsbook data unavailable for this slate. No raw props were displayed.</p>}
                          <div className={finderSport === 'MLB' ? 'space-y-2' : 'hidden'}>
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
                  {conversation.length === 0 && (
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
                  {agentError && (
                    <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/8 p-4 text-left">
                      <p className="text-sm font-semibold text-amber-200">AI research agent unavailable</p>
                      <p className="mt-1 text-xs text-amber-200/80">{agentError}</p>
                      {agentError.includes("OPENAI_API_KEY") && (
                        <p className="mt-2 text-xs text-amber-200/60">
                          Add <span className="font-mono">OPENAI_API_KEY=…</span> to <span className="font-mono">.env.local</span> in the project root, then restart the dev server.
                        </p>
                      )}
                    </div>
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
              {!isSearching && (conversation.length > 0 || results.length > 0 || finderStatus !== 'IDLE') && (
                <div className="space-y-4">

                  {/* AI Conversation */}
                  {results.length === 0 && conversation.length > 0 && !['RESULTS', 'SPORTSBOOK_DATA_REQUIRED', 'EVENT_LIST_REQUIRED', 'PAID_REFRESH_NOT_AUTHORIZED', 'RESERVE_BLOCKED'].includes(finderStatus) && (
                    <div className="space-y-2">
                      {conversation.slice(-4).map((msg, i) => (
                        <div key={i} className={`flex gap-2 text-xs ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                          {msg.role === "ai" && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-teal-500/20 text-[10px]">✨</span>}
                          <div className={`max-w-sm whitespace-pre-wrap rounded-xl px-3 py-2 ${msg.role === "user" ? "bg-white/8 text-slate-300" : "border border-teal-500/15 bg-teal-500/8 text-teal-300"}`}>
                            {msg.text}
                          </div>
                          {msg.role === "user" && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold text-white">LR</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* What the agent actually ran */}
                  {toolTrace.length > 0 && (
                    <div className="rounded-2xl border border-white/6 bg-white/3 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <p className="text-xs font-semibold text-slate-400">Research Steps</p>
                        <button onClick={() => { setResults([]); setToolTrace([]); }}
                          className="text-xs text-teal-400 hover:text-teal-300">Clear</button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {toolTrace.map((trace, index) => (
                          <span key={`${trace.name}-${index}`} className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] ${
                            trace.status === 'SUCCESS'
                              ? 'border-teal-500/20 bg-teal-500/8 text-teal-300'
                              : 'border-amber-500/20 bg-amber-500/8 text-amber-300'
                          }`}>
                            <span className="opacity-60">{trace.name}:</span> {trace.status}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Results header */}
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    {!['SPORTSBOOK_DATA_REQUIRED', 'EVENT_LIST_REQUIRED', 'PAID_REFRESH_NOT_AUTHORIZED', 'RESERVE_BLOCKED'].includes(finderStatus) && (
                      <div className="text-sm text-slate-400">
                        {typeof agentMeta?.gamesFound === 'number' && typeof agentMeta?.gamesScheduled === 'number' && agentMeta.gamesFound < agentMeta.gamesScheduled
                          ? <>Best qualified plays from <span className="font-semibold text-white">{agentMeta.gamesFound}</span> of <span className="font-semibold text-white">{agentMeta.gamesScheduled}</span> researched games &bull; Showing best <span className="font-semibold text-white">{visibleResults.length}</span></>
                          : <>Found <span className="font-semibold text-white">{totalMatched}</span> matching opportunit{totalMatched === 1 ? "y" : "ies"} &bull; Showing best <span className="font-semibold text-white">{visibleResults.length}</span></>}
                      </div>
                    )}
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

                  {/* No results — each cause gets its own honest state */}
                  {results.length === 0 && finderStatus === 'ERROR' && (
                    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6 text-center">
                      <p className="text-lg font-semibold text-white">Research could not run</p>
                      <p className="mt-1 text-sm text-amber-200/80">{agentError ?? 'The research agent is unavailable.'}</p>
                    </div>
                  )}

                  {results.length === 0 && finderStatus === 'SLATE_COMPLETE' && (
                    <div className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-6 text-center">
                      <p className="text-lg font-semibold text-white">This slate has finished</p>
                      <p className="mt-1 text-sm text-slate-400">Every game on {finderDate} is complete, so sportsbooks no longer offer props. Try the next slate.</p>
                    </div>
                  )}

                  {results.length === 0 && finderStatus === 'NO_ELITE_RESULTS' && (
                    <>
                      <div className="rounded-2xl border border-white/6 bg-white/3 p-6 text-center">
                        <p className="text-lg font-semibold text-white">No Elite candidates</p>
                        <p className="mt-1 text-sm text-slate-400">
                          {typeof agentMeta?.candidatesFound === 'number'
                            ? `I researched ${agentMeta.candidatesFound} candidates, but none passed the Elite Filter.`
                            : 'Candidates were researched, but none passed the Elite Filter.'}
                        </p>
                        <p className="mt-2 text-[10px] text-slate-500">Closest misses remain failed-gate research and are never official picks.</p>
                      </div>
                      {closestMisses.length > 0 && (
                        <section className="space-y-3">
                          <div className="rounded-xl border border-amber-400/25 bg-amber-400/8 px-4 py-3">
                            <p className="text-sm font-black uppercase tracking-[0.14em] text-amber-200">Closest Misses</p>
                            <p className="mt-1 text-xs text-amber-100/70">Ranked by distance from existing Elite requirements. Not official DeepSide picks.</p>
                          </div>
                          <div className="grid gap-3 xl:grid-cols-2">
                            {closestMisses.map((result, index) => (
                              <StructuredPickCard key={result.prop.id} result={result} index={index} expanded={false} selectedForCompare={false} onToggle={() => {}} onCompare={() => {}} />
                            ))}
                          </div>
                        </section>
                      )}
                    </>
                  )}

                  {results.length === 0 && (finderStatus === 'SPORTSBOOK_DATA_REQUIRED' || finderStatus === 'EVENT_LIST_REQUIRED') && refreshApprovalOffer && (
                    <div className="rounded-2xl border border-amber-400/30 bg-amber-400/8 p-6">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">{finderStatus}</p>
                      <p className="mt-2 text-lg font-semibold text-white">{finderStatus === 'EVENT_LIST_REQUIRED' ? 'The free sportsbook event list does not contain this requested slate yet.' : 'Sportsbook data is required before DeepSide can research this slate.'}</p>
                      <p className="mt-1 text-sm text-slate-400">{finderStatus === 'EVENT_LIST_REQUIRED' ? 'No paid player-prop request has been made. Cost remains unknown until the target events are discoverable.' : 'No paid request has been made. Review the slate and authorize one capped refresh.'}</p>
                      <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                        <div className="rounded-lg bg-black/15 p-2"><span className="text-slate-500">Sport</span><strong className="mt-1 block text-white">{refreshApprovalOffer.sport.toUpperCase()}</strong></div>
                        <div className="rounded-lg bg-black/15 p-2"><span className="text-slate-500">Date</span><strong className="mt-1 block text-white">{refreshApprovalOffer.date}</strong></div>
                        <div className="rounded-lg bg-black/15 p-2"><span className="text-slate-500">Estimated</span><strong className="mt-1 block text-white">{refreshApprovalOffer.estimatedExpected == null ? 'UNKNOWN' : `${refreshApprovalOffer.estimatedExpected} credits`}</strong></div>
                        <div className="rounded-lg bg-black/15 p-2"><span className="text-slate-500">Maximum authorized</span><strong className="mt-1 block text-white">{refreshApprovalOffer.estimatedHigh == null ? 'UNKNOWN' : `${refreshApprovalOffer.estimatedHigh} credits`}</strong></div>
                        <div className="rounded-lg bg-black/15 p-2"><span className="text-slate-500">Odds credits</span><strong className="mt-1 block text-white">{refreshApprovalOffer.currentCredits ?? 'unavailable'}</strong></div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                        <span>Low: {refreshApprovalOffer.estimatedLow ?? 'UNKNOWN'}</span>
                        <span>Expected: {refreshApprovalOffer.estimatedExpected ?? 'UNKNOWN'}</span>
                        <span>High: {refreshApprovalOffer.estimatedHigh ?? 'UNKNOWN'}</span>
                        <span>{finderStatus === 'EVENT_LIST_REQUIRED' ? `Matched games: ${refreshApprovalOffer.maxGames}` : `Games selected: ${refreshApprovalOffer.maxGames}`}</span>
                      </div>
                      {finderStatus === 'EVENT_LIST_REQUIRED' && (
                        <div className="mt-5 rounded-xl border border-white/8 bg-black/10 p-4">
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">Scheduled NFL Games</p>
                          <div className="mt-3 space-y-2">
                            {refreshApprovalOffer.slateGames.map((game) => (
                              <div key={game.gameId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/8 bg-black/20 px-3 py-2 text-xs">
                                <div><p className="font-semibold text-white">{game.matchup}</p><p className="mt-0.5 text-slate-500">{game.gameTime ? new Date(game.gameTime).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : 'Time unavailable'}</p></div>
                                <span className="rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-1 text-[10px] font-bold text-amber-200">Awaiting sportsbook event</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {finderStatus === 'SPORTSBOOK_DATA_REQUIRED' && refreshApprovalOffer.estimatedHigh != null && (
                        <div className="mt-5 rounded-xl border border-white/8 bg-black/10 p-4">
                          {refreshApprovalOffer.estimatedHigh > (refreshApprovalOffer.currentCredits ?? 0) && (
                            <p className="text-xs text-amber-200">The full slate maximum exceeds your available balance. Full-slate refresh is disabled.</p>
                          )}
                          <div className="mt-3 flex flex-wrap gap-2">
                            {[30, 60, 90].map((budget) => (
                              <button key={budget} onClick={() => { setSelectedRefreshBudget(budget); setCustomRefreshBudget(''); }} className={`rounded-lg border px-3 py-1.5 text-xs ${selectedRefreshBudget === budget && !customRefreshBudget ? 'border-teal-400 bg-teal-400/15 text-teal-200' : 'border-white/10 text-slate-300'}`}>{budget} credits</button>
                            ))}
                            <input value={customRefreshBudget} onChange={(e) => setCustomRefreshBudget(e.target.value.replace(/\D/g, ''))} placeholder="Custom" inputMode="numeric" className="w-24 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white outline-none placeholder:text-slate-500" />
                          </div>
                          {(() => {
                            const budget = Number(customRefreshBudget) > 0 ? Number(customRefreshBudget) : selectedRefreshBudget;
                            const fullSlateGames = refreshApprovalOffer.researchPriorityGames.length || refreshApprovalOffer.maxGames;
                            const safeGames = safelyResearchableGames(budget, fullSlateGames);
                            const plannedGames = manualSelectedGameIds != null
                              ? refreshApprovalOffer.researchPriorityGames.filter((game) => manualSelectedGameIds.includes(game.gameId))
                              : refreshApprovalOffer.researchPriorityGames.slice(0, safeGames);
                            const recommended = plannedGames[0] ?? refreshApprovalOffer.researchPriorityGames[0];
                            return <>
                              <div className="mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/5 p-4">
                                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">Games safely researchable</p>
                                <p className="mt-1 text-xl font-black text-white">{safeGames} of {fullSlateGames}</p>
                                {recommended ? <div className="mt-3 rounded-xl border border-white/8 bg-black/20 p-3">
                                  <div className="flex flex-wrap items-center justify-between gap-2">
                                    <div>
                                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Recommended game</p>
                                      <p className="mt-1 text-base font-bold text-white">{recommended.matchup}</p>
                                    </div>
                                    <span className={`rounded-full border px-2 py-1 text-[10px] font-bold ${recommended.coverage === 'HIGH' ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : recommended.coverage === 'MEDIUM' ? 'border-amber-400/30 bg-amber-400/10 text-amber-300' : 'border-white/10 bg-white/5 text-slate-400'}`}>Research coverage: {recommended.coverage}</span>
                                  </div>
                                  <div className="mt-3 grid gap-2 text-xs text-slate-300 md:grid-cols-2">
                                    <div><p className="mb-1 font-semibold text-emerald-300">Why DeepSide selected it</p>{recommended.reasons.slice(0, 4).map((reason) => <p key={reason}>• {reason}</p>)}</div>
                                    <div><p className="mb-1 font-semibold text-slate-400">Unavailable before purchase</p>{recommended.unavailableEvidence.slice(0, 4).map((item) => <p key={item}>• {item}</p>)}</div>
                                  </div>
                                </div> : <p className="mt-2 text-xs text-slate-500">No free research-priority game is available for this slate yet.</p>}
                                {safeGames > 0 && safeGames < fullSlateGames && <p className="mt-3 text-xs text-amber-200">DeepSide will research part of this slate. Results will not represent the entire MLB slate.</p>}
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <button type="button" onClick={() => setShowGameSelection((open) => !open)} className="rounded-xl border border-white/10 px-3 py-2 text-xs font-bold text-slate-300 hover:text-white">{showGameSelection ? 'Hide Games' : 'Change Game'}</button>
                                  <button onClick={approveWithinBudget} disabled={isSearching || safeGames <= 0} className="rounded-xl border border-teal-400/40 bg-teal-400/10 px-4 py-2 text-sm font-bold text-teal-200 disabled:cursor-not-allowed disabled:opacity-50">{isSearching ? 'Refreshing…' : safeGames === 1 ? 'Analyze Selected Game' : 'Analyze Selected Games'}</button>
                                  <span className="self-center text-xs text-slate-400">Selected: {plannedGames.length}</span>
                                </div>
                                {showGameSelection && <div className="mt-3 max-h-64 space-y-2 overflow-y-auto pr-1">
                                  {refreshApprovalOffer.researchPriorityGames.map((game, index) => {
                                    const checked = manualSelectedGameIds?.includes(game.gameId) ?? index < safeGames;
                                    return <button key={game.gameId} type="button" onClick={() => setManualSelectedGameIds((selected) => {
                                      const current = selected ?? refreshApprovalOffer.researchPriorityGames.slice(0, safeGames).map((item) => item.gameId);
                                      return current.includes(game.gameId) ? current.filter((id) => id !== game.gameId) : [...current, game.gameId];
                                    })} className={`block w-full rounded-xl border p-3 text-left text-xs transition ${checked ? 'border-emerald-400/40 bg-emerald-400/10' : 'border-white/8 bg-white/3 hover:bg-white/6'}`}>
                                      <div className="flex items-center justify-between gap-2"><span className="font-bold text-white">{game.matchup}</span>{index === 0 && <span className="rounded-full bg-emerald-400 px-2 py-0.5 text-[9px] font-black text-slate-950">DeepSide Recommended</span>}</div>
                                      <p className="mt-1 text-slate-400">Coverage {game.coverage} · Priority {game.priority} · {game.gameTime ? new Date(game.gameTime).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'Time unavailable'}</p>
                                    </button>;
                                  })}
                                </div>}
                              </div>
                            </>;
                          })()}
                        </div>
                      )}
                      {finderStatus === 'SPORTSBOOK_DATA_REQUIRED' && canAuthorizeFullSlate(refreshApprovalOffer.estimatedHigh, refreshApprovalOffer.currentCredits) && <button onClick={approveRefreshAndAnalyze} disabled={isSearching} className="mt-3 rounded-xl bg-amber-300 px-4 py-2 text-sm font-bold text-slate-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-50">{isSearching ? 'Refreshing…' : 'Refresh & Analyze Full Slate'}</button>}
                    </div>
                  )}

                  {results.length === 0 && !['ERROR', 'SLATE_COMPLETE', 'NO_ELITE_RESULTS', 'SPORTSBOOK_UNAVAILABLE', 'SPORTSBOOK_DATA_REQUIRED', 'EVENT_LIST_REQUIRED'].includes(finderStatus) && (
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
                  {results.length > 0 && (
                    <>
                      <p className="rounded-2xl border border-emerald-400/15 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-100">
                        DeepSide found {results.length} Elite-qualified opportunit{results.length === 1 ? 'y' : 'ies'} from {typeof agentMeta?.candidatesFound === 'number' ? agentMeta.candidatesFound : 'the'} researched candidates.
                      </p>
                      <div className="grid gap-3 xl:grid-cols-2">
                        {visibleResults.map((result, index) => (
                          <StructuredPickCard
                            key={result.prop.id}
                            result={result}
                            index={index}
                            expanded={selectedPlayIndex === index}
                            selectedForCompare={selectedIds.has(result.prop.id)}
                            onToggle={() => setSelectedPlayIndex((selected) => selected === index ? null : index)}
                            onCompare={toggleSelect}
                          />
                        ))}
                      </div>
                      {selectedPlayIndex != null && visibleResults[selectedPlayIndex] && (
                        <TabbedPlayResearch
                          results={[visibleResults[selectedPlayIndex]]}
                          selectedIndex={0}
                          onSelect={() => {}}
                          onCompare={toggleSelect}
                          onAsk={(followUp) => { setQuery(followUp); runSearch(followUp); }}
                          finderDate={finderDate}
                          showSelector={false}
                        />
                      )}
                    </>
                  )}

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

              {/* Last analysis */}
              {analysisChips.length > 0 && (
                <div className="rounded-2xl border border-teal-500/15 bg-teal-500/5 p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">Last Analysis</h3>
                    <button onClick={() => { setResults([]); setToolTrace([]); }} className="text-[10px] text-slate-500 hover:text-white">Clear</button>
                  </div>
                  <div className="space-y-1">
                    {analysisChips.map(({ label, value }) => (
                      <div key={label} className="flex items-center justify-between text-[10px]">
                        <span className="text-slate-500">{label}</span>
                        <span className="font-semibold text-teal-400">{value}</span>
                      </div>
                    ))}
                  </div>
                  {oddsSpendLabel && (
                    <p className={`mt-2 border-t border-white/5 pt-2 text-[9px] font-mono ${oddsSpend?.paidRequestsMade ? 'text-amber-400' : 'text-slate-500'}`}>{oddsSpendLabel}</p>
                  )}
                </div>
              )}
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}
