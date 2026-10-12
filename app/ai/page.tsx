"use client";

import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AppSidebar } from "../../components/AppSidebar";
import { FuturisticBackground } from "../../components/FuturisticBackground";
import { MobileBottomNav } from "../../components/MobileBottomNav";
import { DeepSideLogo } from "../../components/DeepSideLogo";
import { NewsUnavailablePanel } from "../../components/NewsUnavailablePanel";
import { PlayerAvatar } from "../../components/PlayerAvatar";
import { PlayerHeadshot } from "../../components/PlayerHeadshot";
import { TeamLogo } from "../../components/TeamLogo";
import { NFLHistorySummary } from "../../components/NFLHistorySummary";
import { NFLSlateSummary } from "../../components/NFLSlateSummary";
import { NFLParticipationSummary } from "../../components/NFLParticipationSummary";
import type { NFLInjuryContext } from "../../lib/nfl/injuries";
import { NFLSportsbookPrices } from "../../components/NFLSportsbookPrices";
import type { NFLSportsbookPrice } from "../../lib/nfl/underlyingPlays";
import { nflMatchupLabel } from "../../lib/nfl/matchupLabel";
import type { NFLCorrelationGroup } from "../../lib/nfl/correlation";
import type { NFLSlateLedger } from "../../lib/nfl/slateLedger";
import type { NFLMarketHistory } from "../../lib/nfl/history";
import type { NFLResearchProfile } from "../../lib/nfl/researchModel";
import type { NBAProjectionResult } from "../../lib/nba/prediction/types";
import type { GameRecommendation, ModeledGameResearch } from "../../lib/nba/prediction/gameLines/recommendations";
import { NBAGameRecommendationCard, NBAModeledGameResearch } from "../../components/NBAGameRecommendationCard";
import { NBAPresentationCards, type NBAClientPresentation } from "../../components/NBAPresentationCards";
import type { PickTier } from "../../lib/ai/agent/pickTiers";
import { getResearchHref } from "../../lib/researchHref";
import { resolveSlateDate, todaySlateDate, tomorrowSlateDate, presetForSlateDate } from "../../lib/dateModel";
import { type AiResult, type AiSearchCriteria } from "../../lib/ai";
import { analyzePickCandidate, finderResultToEliteCandidate } from "../../lib/ai/eliteResearchFilter";
import type { FinderRunSummary } from "../../lib/finder/engine";
import type { NFLCandidate } from "../../lib/finder/nflEngine";
import { formatDisplayDate, resolveDateFromText } from "../../lib/ai/dateResolver";
import { detectSport } from "../../lib/ai/sportResearchAdapters";


// ─── constants ────────────────────────────────────────────────────────────────

const SECONDARY_SUGGESTIONS = [
  { label: "Highest Confidence", query: "Show me 5 high confidence MLB props 80%+" },
  { label: "Best Overs", query: "Find 5 strong over props" },
  { label: "Best Unders", query: "Find 5 strong under props" },
  { label: "Pitcher Strikeouts", query: "Find pitcher strikeout props with favorable matchups" },
];

const RISK_STYLES = {
  LOW: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  MEDIUM: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  HIGH: "border-rose-500/40 bg-rose-500/10 text-rose-400",
};

const PICK_TIER_STYLES: Record<PickTier, { badge: string; label: string; border: string; accent: string }> = {
  NUKE: { badge: 'border-amber-300/70 bg-amber-300/15 text-amber-200', label: 'text-amber-200', border: 'border-amber-300/55 shadow-[0_0_24px_rgba(251,191,36,0.10)]', accent: 'text-amber-200' },
  ELITE: { badge: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300', label: 'text-emerald-300', border: 'border-emerald-400/30', accent: 'text-emerald-300' },
  SHARP: { badge: 'border-cyan-400/35 bg-cyan-400/10 text-cyan-200', label: 'text-cyan-200', border: 'border-cyan-400/25', accent: 'text-cyan-200' },
  EDGE: { badge: 'border-sky-400/30 bg-sky-400/8 text-sky-200', label: 'text-sky-200', border: 'border-sky-400/20', accent: 'text-sky-200' },
  LEAN: { badge: 'border-white/15 bg-white/5 text-slate-300', label: 'text-slate-300', border: 'border-white/10', accent: 'text-slate-200' },
  PASS: { badge: 'border-rose-400/25 bg-rose-400/5 text-rose-200', label: 'text-rose-200', border: 'border-rose-400/20', accent: 'text-slate-300' },
};

type SearchMode = "quick" | "deep" | "builder";
type FinderStatus = 'IDLE' | 'LOADING' | 'SLATE_COMPLETE' | 'EVENT_LIST_REQUIRED' | 'SPORTSBOOK_DATA_REQUIRED' | 'SPORTSBOOK_UNAVAILABLE' | 'RESEARCHING' | 'NO_ELITE_RESULTS' | 'RESULTS' | 'ERROR'
  | 'DATA_UNAVAILABLE' | 'TEMP_UNAVAILABLE' | 'CONNECTION_ERROR' | 'CLARIFY' | 'ANSWER' | 'RESEARCH_INCOMPLETE';

const SEARCH_TOOLS = new Set(['get_sportsbook_candidates', 'rank_candidates', 'run_elite_filter']);

/** Maps an internal tool status to the user-facing state; raw codes never reach the UI. */
function classifyLoadFailure(status: string): FinderStatus {
  if (status === 'RESEARCH_INCOMPLETE') return 'RESEARCH_INCOMPLETE';
  if (status === 'PROVIDER_ERROR') return 'CONNECTION_ERROR';
  if (status === 'SLATE_COMPLETE') return 'SLATE_COMPLETE';
  if (status === 'NO_CANDIDATES' || status === 'NO_ELITE_RESULTS') return 'NO_ELITE_RESULTS';
  if (status === 'INVALID_DATE') return 'CLARIFY';
  if (['SPORTSBOOK_DATA_REQUIRED', 'PAID_REFRESH_NOT_AUTHORIZED', 'RESERVE_BLOCKED', 'BUDGET_LIMITED'].includes(status)) return 'TEMP_UNAVAILABLE';
  return 'DATA_UNAVAILABLE';
}

/** Renders model text as headings/bullets/short paragraphs instead of one block. */
function StructuredAnswer({ text }: { text: string }) {
  const blocks = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  return (
    <div className="mt-2 space-y-2">
      {blocks.map((line, index) => {
        const bullet = line.match(/^(?:[-*•]|\d+\.)\s+(.*)$/);
        const heading = line.match(/^#{1,4}\s+(.*)$/) ?? (line.length <= 48 && /^[A-Z0-9 /&'-]+:?$/.test(line) ? [line, line.replace(/:$/, '')] : null);
        const clean = (value: string) => value.replace(/\*\*(.*?)\*\*/g, '$1');
        if (heading) return <p key={index} className="pt-1 text-xs font-black uppercase tracking-[0.16em] text-slate-400">{clean(heading[1])}</p>;
        if (bullet) return <p key={index} className="flex gap-2 text-sm text-slate-300"><span className="text-emerald-400">•</span><span>{clean(bullet[1])}</span></p>;
        return <p key={index} className="text-sm leading-relaxed text-slate-300">{clean(line)}</p>;
      })}
    </div>
  );
}
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
  retrievedAt?: string | null;
  priceFreshness: string;
  priceCurrent: boolean;
  valueQualified: boolean;
  dataQuality: number;
  trapRisk: number;
  qualification: string;
  eliteQualified: boolean;
  pickTier?: PickTier;
  tierReason?: string;
  tierScore?: number;
  tierRequirementsPassed?: string[];
  tierRequirementsFailed?: string[];
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
  nflHistory?: NFLMarketHistory | null;
  availablePrices?: NFLSportsbookPrice[];
  correlationGroups?: NFLCorrelationGroup[];
  nflResearchProfile?: NFLResearchProfile;
  nbaPrediction?: NBAProjectionResult | null;
  nbaInjuryEvidence?: import('../../lib/nba/prediction/types').NBAInjuryEvidence;
}

type UiAiResult = AiResult & { sourceRecord?: AgentResultRecord; closestMiss?: boolean };

interface AgentChatResponse {
  reply: string;
  nbaPresentation?: NBAClientPresentation;
  toolTrace?: AgentToolTrace[];
  results?: (AgentResultRecord | GameRecommendation)[];
  modeledGames?: ModeledGameResearch[];
  closestMisses?: AgentResultRecord[];
  meta?: Record<string, unknown> | null;
  /** Opaque ID for the server-side research session — never the full (possibly hundreds-of-candidates) object. */
  researchSessionId?: string | null;
  ledgerReceipt?: string | null;
  error?: string;
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

type ResearchSectionStatus = 'STRONG' | 'FAVORABLE' | 'NEUTRAL' | 'UNFAVORABLE' | 'PARTIAL DATA' | 'CAUTION' | 'RISK' | 'UNAVAILABLE';

const SECTION_STATUS_STYLES: Record<ResearchSectionStatus, string> = {
  STRONG: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300',
  FAVORABLE: 'border-teal-400/30 bg-teal-400/10 text-teal-300',
  UNFAVORABLE: 'border-rose-400/30 bg-rose-400/10 text-rose-300',
  'PARTIAL DATA': 'border-amber-400/30 bg-amber-400/10 text-amber-300',
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
    aiReason: record.tierReason ?? record.evidenceBoard.find((entry) => entry.status === 'agree')?.detail ?? `Qualified as ${record.pickTier ?? (record.eliteQualified ? 'ELITE' : 'PASS')} by DeepSide's research checks.`,
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
    trapRisk: analysis.trapRisk, qualification: analysis.qualification,
    eliteQualified: analysis.eliteQualified && candidate.nflResearchProfile?.productionEliteQualified === true,
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
    nflResearchProfile: candidate.nflResearchProfile ?? undefined,
  }, 'NFL');
  return { ...result, closestMiss: !result.sourceRecord?.eliteQualified };
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
  if (section === 'matchup') return result.prop.sport === 'NFL' ? nflMatchupLabel((result as UiAiResult).sourceRecord?.opponentContext as { status?: string } | undefined) : result.prop.opponent ? 'FAVORABLE' : 'UNAVAILABLE';
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
  const nbaPrediction = source?.nbaPrediction ?? null;
  const tier: PickTier = source?.pickTier ?? (source?.eliteQualified ? 'ELITE' : 'PASS');
  const tierStyle = PICK_TIER_STYLES[tier];
  const price = source?.odds ?? (prop.researchSide === 'Under' ? prop.underOdds : prop.overOdds);
  const edge = analysis?.priceEdgePercent ?? deepResearch?.priceEdgePercent ?? null;
  const profile = source?.nflResearchProfile;
  const reasons = profile?.evidence.for.slice(0, 3).map((entry) => entry.statement) ?? [];
  if (reasons.length === 0) reasons.push(deepResearch?.evidenceBoard.find((entry) => entry.status === 'agree')?.detail ?? result.matchReasons[0] ?? 'Research evidence unavailable.');
  const risk = profile?.evidence.against[0]?.statement ?? deepResearch?.howItLoses?.[0] ?? result.riskNotes[0] ?? 'Risk detail unavailable.';

  return (
    <article className={`rounded-2xl border bg-[#08120f] p-4 transition ${tierStyle.border} ${expanded ? 'shadow-[0_12px_40px_rgba(0,0,0,0.25)]' : 'hover:border-white/20'}`}>
      <div className="flex items-start gap-3">
        <PlayerHeadshot sport={prop.sport} playerId={prop.playerId} playerName={prop.player} teamId={prop.teamId} teamName={prop.team} size={64} className="ring-1 ring-white/10" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={`text-[10px] font-bold uppercase tracking-[0.16em] ${result.closestMiss ? 'text-amber-300' : tierStyle.label}`}>#{source?.rank ?? index + 1} · {result.closestMiss ? 'Closest Research Miss' : tier}</p>
              <h3 className="text-lg font-black leading-tight text-white [overflow-wrap:anywhere]">{prop.player}</h3>
              <p className="mt-0.5 text-xs leading-snug text-slate-400">{prop.team}{prop.opponent && prop.opponent !== 'Unavailable' ? ` vs ${prop.opponent}` : ''}</p>
              {prop.sport === 'NFL' && <p className="mt-1 text-[9px] font-semibold uppercase text-slate-500">{profile?.researchMode === 'DEEP' ? 'DEEP RESEARCH' : 'STANDARD RESEARCH'}</p>}
            </div>
            <span className={`shrink-0 rounded-full border px-2 py-1 text-[10px] font-black ${tierStyle.badge}`}>{tier}{tier === 'NUKE' ? ` · ${source?.tierScore ?? analysis?.researchScore}/100` : ''}</span>
          </div>
          <p className="mt-3 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">{prop.propType}</p>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-2xl font-black text-white">{prop.researchSide.toUpperCase()} {prop.line}</span>
            <span className="text-sm font-bold text-emerald-300">{odds(price)}</span>
            <span className="text-xs text-slate-500">{prop.sportsbookName ?? 'Sportsbook unavailable'}</span>
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 divide-x divide-y divide-white/8 border-y border-white/8 py-2 text-center sm:grid-cols-5 sm:divide-y-0">
        <div><p className="text-[9px] uppercase text-slate-500">Score</p><p className={`mt-1 font-black ${tierStyle.accent}`}>{source?.tierScore ?? analysis?.researchScore ?? result.matchScore}{tier === 'NUKE' ? '/100' : ''}</p></div>
        <div><p className="text-[9px] uppercase text-slate-500">Probability</p><p className={`mt-1 font-black ${tier === 'NUKE' ? 'text-amber-200' : 'text-emerald-300'}`}>{pct(analysis?.trueProbability)}</p></div>
        <div><p className="text-[9px] uppercase text-slate-500">Implied</p><p className="mt-1 font-black text-white">{pct(profile?.market.value?.impliedProbability ?? analysis?.breakEvenProbability)}</p></div>
        <div><p className="text-[9px] uppercase text-slate-500">Edge</p><p className="mt-1 font-black text-white">{pct(edge)}</p></div>
        <div><p className="text-[9px] uppercase text-slate-500">Trap</p><p className="mt-1 font-black text-amber-300">{analysis?.trapRisk ?? 'Unavailable'}</p></div>
      </div>

      {prop.sport === 'NBA' && nbaPrediction && <div className="mt-3 space-y-2 border-b border-white/8 pb-3">
        <div className="grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <div><p className="text-[9px] uppercase text-slate-500">Push</p><p className="mt-1 font-bold text-white">{nbaPrediction.probabilities ? pct(nbaPrediction.probabilities.push * 100) : 'Unavailable'}</p></div>
          <div><p className="text-[9px] uppercase text-slate-500">Fair odds</p><p className="mt-1 font-bold text-white">{nbaPrediction.fairAmericanOdds == null ? 'Unavailable' : odds(nbaPrediction.fairAmericanOdds)}</p></div>
          <div><p className="text-[9px] uppercase text-slate-500">Push-aware EV</p><p className={`mt-1 font-bold ${(nbaPrediction.expectedValuePercent ?? -1) > 0 ? 'text-emerald-300' : 'text-slate-300'}`}>{pct(nbaPrediction.expectedValuePercent)}</p></div>
          <div><p className="text-[9px] uppercase text-slate-500">Phase / price</p><p className="mt-1 font-bold text-white">{nbaPrediction.targetPhase.replace('_', ' ')} / {nbaPrediction.quoteStatus}</p></div>
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-slate-500">
          <span>{nbaPrediction.modelVersion} · {nbaPrediction.validationStatus}</span>
          <span>n={nbaPrediction.sampleSize} · minutes n={nbaPrediction.minutesSampleSize}</span>
          {source?.nbaInjuryEvidence && <span>Availability: {source.nbaInjuryEvidence.replaceAll('_', ' ')}</span>}
          {source?.retrievedAt && <span>Quote {new Date(source.retrievedAt).toLocaleString()}</span>}
        </div>
        {nbaPrediction.contextEvidence.length > 0 && <div className="space-y-1 text-xs text-slate-300">
          {nbaPrediction.contextEvidence.slice(0, 2).map((evidence) => <p key={evidence.id}><span className="font-semibold text-emerald-300">{evidence.kind}/{evidence.state}:</span> {evidence.detail}</p>)}
        </div>}
        {nbaPrediction.intelligenceEvidence.length > 0 && <div className="space-y-1 text-xs text-slate-300">
          {nbaPrediction.intelligenceEvidence.slice(0, 2).map((evidence) => <p key={evidence.id}><span className="font-semibold text-amber-300">{evidence.kind}/{evidence.direction}:</span> {evidence.detail}</p>)}
        </div>}
        {nbaPrediction.contextMissing.length > 0 && <p className="text-[10px] text-slate-500">Context gaps: {nbaPrediction.contextMissing.slice(0, 3).join('; ')}</p>}
        <p className="text-[10px] text-amber-200">Probability model is UNVALIDATED; this estimate is not proven accuracy.</p>
      </div>}

      <div className="mt-3 space-y-2 text-xs leading-5">
        {reasons.map((reason, reasonIndex) => <p key={`${reasonIndex}-${reason}`} className="text-slate-300"><span className="font-bold text-emerald-300">{reasonIndex === 0 ? 'Why:' : 'Also:'}</span> {reason}</p>)}
        <p className="text-slate-400"><span className="font-bold text-amber-300">Risk:</span> {risk}</p>
        {prop.sport === 'NFL' && source?.correlationGroups?.map(group => <p key={group.id} className="text-amber-200"><span className="font-bold">Correlated:</span> {group.label} · {group.relatedPlays} linked plays, not independent bets.</p>)}
        {tier === 'PASS' && <p className="rounded-lg border border-rose-400/20 bg-rose-400/5 px-2 py-1.5 text-rose-200"><span className="font-bold">PASS:</span> {(source?.tierRequirementsFailed ?? source?.rejectionReasons ?? analysis?.rejectedReasons ?? []).join(' + ') || 'Publication requirements were not met.'}</p>}
      </div>

      <div className="mt-4 flex items-center justify-between gap-2">
        <button onClick={onToggle} className="rounded-xl bg-emerald-400 px-3 py-2 text-xs font-black text-slate-950 hover:bg-emerald-300">{expanded ? 'Close Research' : 'View Full Research'}</button>
        <button onClick={() => onCompare(prop.id)} className={`rounded-xl border px-3 py-2 text-xs font-bold ${selectedForCompare ? 'border-emerald-400/50 text-emerald-300' : 'border-white/10 text-slate-400 hover:text-white'}`}>{selectedForCompare ? 'Selected' : 'Compare'}</button>
      </div>
      {prop.sport === 'NFL' && source?.availablePrices && <NFLSportsbookPrices prices={source.availablePrices} primary={source.book} />}
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

function nflLayerStatus(status: NFLResearchProfile['market']['status']): ResearchSectionStatus {
  if (status === 'AVAILABLE') return 'STRONG';
  if (status === 'PARTIAL_DATA') return 'PARTIAL DATA';
  if (status === 'NOT_APPLICABLE') return 'NEUTRAL';
  return 'UNAVAILABLE';
}

function NFLProfileMetric({ label, value, showUnavailable = false }: { label: string; value: unknown; showUnavailable?: boolean }) {
  if (value == null || value === '' || value === 'Unavailable') return showUnavailable ? <MetricTile label={label} value="Unavailable" /> : null;
  return <MetricTile label={label} value={typeof value === 'object' ? JSON.stringify(value) : String(value)} />;
}

function hasNFLUsage(value: { lastGame: number | null; l3: number | null; l5: number | null; season: number | null } | undefined) {
  return value != null && [value.lastGame, value.l3, value.l5, value.season].some((entry) => entry != null);
}

function NFLResearchProfileDetails({ profile }: { profile: NFLResearchProfile }) {
  const show = (value: unknown) => value == null || value === '' ? 'Unavailable' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  const usageText = (value: { lastGame: number | null; l3: number | null; l5: number | null; season: number | null } | undefined) =>
    value ? `${show(value.lastGame)} / ${show(value.l3)} / ${show(value.l5)} / ${show(value.season)}` : 'Unavailable';
  const list = (items: string[] | undefined, empty = 'Unavailable') => items?.length
    ? <ul className="space-y-1 text-sm text-slate-300">{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
    : <p className="text-sm text-slate-500">{empty}</p>;
  const role = profile.role.value;
  const market = profile.market.value;
  const script = profile.gameScript.value;
  const gameEnvironment = profile.gameEnvironmentModel ?? profile.projectionModel?.gameEnvironmentModel ?? script?.environmentModel;
  const scheme = profile.schemeMatchup.value;
  const matchup = profile.matchupModel ?? profile.projectionModel?.matchupModel ?? scheme?.matchupAnalysis;
  const trench = profile.trench.value;
  const injuries = profile.injuryNetwork.value;
  const practice = profile.practice.value;
  const weather = profile.weather.value;
  const movement = profile.marketIntelligence.value;
  const seasonContextLayer = profile.seasonContext;
  const seasonContext = seasonContextLayer?.value;
  const gates = Object.entries(profile.hardGates) as Array<[keyof NFLResearchProfile['hardGates'], NFLResearchProfile['hardGates'][keyof NFLResearchProfile['hardGates']]]>;

  return <div className="space-y-2 border-t border-white/8 pt-4">
    <p className="text-[10px] font-semibold uppercase text-slate-400">{profile.researchMode === 'DEEP' ? 'Deep Research' : 'Standard Research'}</p>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs font-bold uppercase text-emerald-300">NFL Research · {profile.sportFilterVersion}</p>
      <p className="text-xs text-slate-400">NFL weighted score: {profile.score.score == null ? 'Unavailable' : `${profile.score.score}/100 · ${profile.score.classification}`}</p>
    </div>
    <p className="text-xs text-amber-200">The NFL score classification is separate from the preserved production Elite threshold ({profile.score.productionEliteBoundary}); the requested score boundary is {profile.score.scoreEliteBoundary}.</p>
    <ResearchRow title="NFL Score Coverage" status={nflLayerStatus(profile.score.score == null ? 'PARTIAL_DATA' : 'AVAILABLE')}>
      <div className="space-y-2">{Object.entries(profile.score.components).map(([key, component]) => <div key={key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-white/5 py-2 text-xs sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]"><span className="break-words text-slate-300">{key.replaceAll(/([A-Z])/g, ' $1')}</span><span className="text-white">{component.componentScore == null ? 'Score unavailable' : `${component.componentScore}/100 · ${component.points?.toFixed(1)} pts`}</span><span className="text-slate-400">{component.weight}% weight · {component.evidenceCoverage == null ? 'coverage unavailable' : `${component.evidenceCoverage}% coverage`}</span><span className="text-slate-500">{component.confidence ?? 'confidence unavailable'}</span></div>)}</div>
      <p className="mt-3 text-xs text-amber-200">Weighted total remains unavailable unless every component has sufficient evidence coverage.</p>
    </ResearchRow>
    <ResearchRow title="Season Context" status={nflLayerStatus(seasonContextLayer?.status ?? 'UNAVAILABLE')}>
      {seasonContext ? <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <NFLProfileMetric label="Season phase" value={`${seasonContext.week == null ? '' : `Week ${seasonContext.week} · `}${seasonContext.phase.replaceAll('_', ' ')}`} />
          <NFLProfileMetric label="Season / game number" value={seasonContext.season == null ? null : `${seasonContext.season}${seasonContext.gameNumber == null ? '' : ` · Player game ${seasonContext.gameNumber}`}`} />
          <NFLProfileMetric label="Postseason round" value={seasonContext.playoffRound?.replaceAll('_', ' ')} />
          <NFLProfileMetric label="Team situation" value={seasonContext.teamSituation} />
          <NFLProfileMetric label="Context impact" value={seasonContext.impact === 'NEUTRAL' ? 'No material season-context adjustment identified.' : seasonContext.impact} />
          <NFLProfileMetric label="Confidence" value={seasonContext.confidence} />
          <NFLProfileMetric label="Projection adjustment" value={seasonContext.projectionAdjustment == null ? 'None; no validated phase adjustment is applied.' : seasonContext.projectionAdjustment} />
        </div>
        {seasonContext.playerContext.length > 0 && <div><p className="mb-1 text-[10px] font-bold uppercase text-slate-500">Player Context</p>{list(seasonContext.playerContext)}</div>}
        {seasonContext.phaseHistory.length > 0 && <div><p className="mb-1 text-[10px] font-bold uppercase text-slate-500">Season-Phase Evidence</p>{list(seasonContext.phaseHistory)}</div>}
        {seasonContext.notes.length > 0 && <div><p className="mb-1 text-[10px] font-bold uppercase text-amber-200">Context / Counter-Case</p>{list(seasonContext.notes)}</div>}
        {seasonContext.missingData.length > 0 && <div><p className="mb-1 text-[10px] font-bold uppercase text-slate-500">Unavailable To DeepSide</p>{list(seasonContext.missingData)}</div>}
      </div> : <p className="text-sm text-slate-400">No material season-context adjustment identified.</p>}
    </ResearchRow>
    <ResearchRow title="Projected Opportunity" status={profile.projectionModel ? 'PARTIAL DATA' : 'UNAVAILABLE'}>
      {profile.projectionModel ? <div className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <NFLProfileMetric label="Projection model" value={profile.projectionModel.modelType.replaceAll('_', ' ')} />
          <NFLProfileMetric label={profile.projectionModel.opportunityLabel ?? 'Expected opportunity'} value={num(profile.projectionModel.expectedOpportunity, 1)} />
          <NFLProfileMetric label={profile.projectionModel.efficiencyLabel ?? 'Expected efficiency'} value={profile.projectionModel.expectedEfficiency == null ? null
            : ['Catch rate', 'Completion rate'].includes(profile.projectionModel.efficiencyLabel ?? '')
              ? `${(profile.projectionModel.expectedEfficiency * 100).toFixed(1)}%` : num(profile.projectionModel.expectedEfficiency, 2)} />
          <NFLProfileMetric label="Opportunity projection" value={profile.projectionModel.opportunityProjection} />
          <NFLProfileMetric label="Historical baseline" value={profile.projectionModel.historicalBaseline} />
          <NFLProfileMetric label="Final projection" value={profile.projectionModel.finalProjection} />
          <NFLProfileMetric label="Opportunity sample · current / prior" value={`${profile.projectionModel.currentSeasonOpportunityGames} / ${profile.projectionModel.priorSeasonOpportunityGames}`} />
          <NFLProfileMetric label="Projection uncertainty" value={profile.projectionModel.uncertainty} />
          <NFLProfileMetric label="Opportunity confidence" value={profile.projectionModel.confidence} />
          <NFLProfileMetric label="Calibration status" value={profile.projectionModel.calibrationStatus} />
          <NFLProfileMetric label="Season phase" value={profile.projectionModel.seasonPhase.replaceAll('_', ' ')} />
        </div>
        <p className="text-xs leading-relaxed text-slate-400">{profile.projectionModel.modelType === 'HISTORICAL_BASELINE_ONLY'
          ? 'Historical baseline only; sufficient paired opportunity data is unavailable.'
          : `Expected production combines recorded player opportunity and observed efficiency with the historical baseline. Opportunity confidence is ${profile.projectionModel.confidence.toLowerCase()}; advanced participation metrics remain unavailable.`}</p>
        {profile.projectionModel.notes.map((note) => <p key={note} className="text-xs text-slate-300">{note}</p>)}
        {profile.projectionModel.missingInputs.length > 0 && <div><p className="mb-1 text-[10px] font-bold uppercase text-amber-200">Unavailable Opportunity Inputs</p>{list(profile.projectionModel.missingInputs)}</div>}
      </div> : <p className="text-sm text-slate-400">Opportunity decomposition unavailable; historical projection only.</p>}
    </ResearchRow>
    <ResearchRow title="Role / Opportunity" status={nflLayerStatus(profile.role.status)}>
      <div className="grid gap-2 sm:grid-cols-2"><NFLProfileMetric label="Role / trend" value={`${role?.roleStatus ?? ''}${role?.roleTrend ? ` / ${role.roleTrend}` : ''}`} /><NFLProfileMetric label="Current-season role stability" value={role?.roleStability} /><NFLProfileMetric label="Confidence" value={role?.roleConfidence} />
        {role?.position === 'QB' && <>{hasNFLUsage(role.positionUsage.passAttempts) && <NFLProfileMetric label="Pass attempts · last game / L3 / L5 / season" value={usageText(role.positionUsage.passAttempts)} />}{hasNFLUsage(role.positionUsage.rushingAttempts) && <NFLProfileMetric label="Rushing attempts · last game / L3 / L5 / season" value={usageText(role.positionUsage.rushingAttempts)} />}</>}
        {role?.position === 'RB' && <>{hasNFLUsage(role.positionUsage.rushingAttempts) && <NFLProfileMetric label="Carries · last game / L3 / L5 / season" value={usageText(role.positionUsage.rushingAttempts)} />}{hasNFLUsage(role.positionUsage.touches) && <NFLProfileMetric label="Touches · last game / L3 / L5 / season" value={usageText(role.positionUsage.touches)} />}{hasNFLUsage(role.positionUsage.targets) && <NFLProfileMetric label="Targets · last game / L3 / L5 / season" value={usageText(role.positionUsage.targets)} />}{hasNFLUsage(role.positionUsage.receptions) && <NFLProfileMetric label="Receptions · last game / L3 / L5 / season" value={usageText(role.positionUsage.receptions)} />}{hasNFLUsage(role.positionUsage.touchdowns) && <NFLProfileMetric label="Touchdowns · last game / L3 / L5 / season" value={usageText(role.positionUsage.touchdowns)} />}</>}
        {(role?.position === 'WR' || role?.position === 'TE') && <>{hasNFLUsage(role.positionUsage.targets) && <NFLProfileMetric label="Targets · last game / L3 / L5 / season" value={usageText(role.positionUsage.targets)} />}{hasNFLUsage(role.positionUsage.receptions) && <NFLProfileMetric label="Receptions · last game / L3 / L5 / season" value={usageText(role.positionUsage.receptions)} />}{hasNFLUsage(role.positionUsage.touchdowns) && <NFLProfileMetric label="Touchdowns · last game / L3 / L5 / season" value={usageText(role.positionUsage.touchdowns)} />}</>}
        <NFLProfileMetric label="Snap share" value={role?.snapShare} /><NFLProfileMetric label="Route participation" value={role?.routeParticipation} /><NFLProfileMetric label="Target share / air yards" value={role?.targetShare ?? role?.airYardShare} /></div>
      <div className="mt-3">{list(role?.roleEvidence)}</div><div className="mt-2">{list(role?.roleStabilityEvidence)}</div><div className="mt-2">{list(profile.role.missingFields)}</div>
    </ResearchRow>
    <ResearchRow title="Game Script" status={nflLayerStatus(profile.gameScript.status)}>
      {script?.thesis && <p className="text-sm text-slate-300">{script.thesis}</p>}
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <NFLProfileMetric label="Candidate spread" value={gameEnvironment?.inputs.candidateSpread} />
        <NFLProfileMetric label="Game total" value={gameEnvironment?.inputs.total ?? script?.total} />
        <NFLProfileMetric label="Derived team / opponent total" value={gameEnvironment?.inputs.teamTotal == null ? null : `${gameEnvironment.inputs.teamTotal} / ${show(gameEnvironment.inputs.opponentTeamTotal)}`} />
        <NFLProfileMetric label="Market-implied leader" value={gameEnvironment?.inputs.expectedLeader ?? script?.expectedLeader} />
        <NFLProfileMetric label="Expected margin" value={gameEnvironment?.inputs.expectedMargin} />
        <NFLProfileMetric label="Expected script" value={gameEnvironment?.expectedScript.replaceAll('_', ' ')} />
        <NFLProfileMetric label="Projected team plays" value={gameEnvironment?.expectedTeamVolume.plays} showUnavailable />
        <NFLProfileMetric label="Projected team pass / rush attempts" value={gameEnvironment?.expectedTeamVolume.passAttempts == null ? null : `${gameEnvironment.expectedTeamVolume.passAttempts} / ${show(gameEnvironment.expectedTeamVolume.rushAttempts)}`} showUnavailable />
        <NFLProfileMetric label="Expected possessions" value={gameEnvironment?.expectedTeamVolume.possessions} showUnavailable />
        <NFLProfileMetric label="Script confidence" value={gameEnvironment?.confidence ?? (script?.confidence === 'UNKNOWN' ? null : script?.confidence)} />
        <NFLProfileMetric label="Player opportunity · base / script" value={gameEnvironment?.phase2Opportunity == null ? null : `${gameEnvironment.phase2Opportunity} / ${show(gameEnvironment.expectedPlayerOpportunity)}`} />
        <NFLProfileMetric label="Volume adjustment" value={gameEnvironment ? gameEnvironment.volumeAdjustment : null} />
      </div>
      {gameEnvironment ? <div className="mt-3 space-y-3">
        <p className="text-xs text-slate-500">{gameEnvironment.snapshotOnly ? 'Saved script snapshot' : 'Game environment'} · {gameEnvironment.evaluatedAt}</p>
        <p className="text-sm text-slate-300">{gameEnvironment.passRushEnvironment}</p>
        <p className="text-xs text-slate-400">{gameEnvironment.adjustmentReason}</p>
        {list(gameEnvironment.evidence)}
        <div><p className="mb-1 text-[10px] font-bold uppercase text-amber-200">Game-Flow Counter-Case</p>{list(gameEnvironment.counterCase)}</div>
        {gameEnvironment.scenarios.length > 0 && <div className="space-y-2"><p className="text-[10px] font-bold uppercase text-slate-400">Deep Script Scenarios</p>{gameEnvironment.scenarios.map((scenario) => <div key={scenario.name} className="border-l border-white/15 pl-3"><p className="text-xs font-semibold text-slate-200">{scenario.name} · {scenario.scoreState}</p><p className="text-sm text-slate-300">{scenario.opportunityImpact}</p></div>)}<p className="text-xs text-slate-500">Conditional scenarios; probabilities and projection ranges are unavailable.</p></div>}
        <div><p className="mb-1 text-[10px] font-bold uppercase text-slate-400">Missing Game-Script Inputs</p>{list(gameEnvironment.missingInputs)}</div>
      </div> : <div className="mt-2">{list(script?.evidence)}{list(profile.gameScript.missingFields)}</div>}
    </ResearchRow>
    <ResearchRow title="Scheme Matchup" status={nflLayerStatus(profile.schemeMatchup.status)}>
      {matchup && <div className="mb-3 space-y-2">
        <p className="text-xs text-slate-500">{matchup.snapshotOnly ? 'Saved matchup snapshot' : 'Matchup analysis'} · {matchup.evaluatedAt}</p>
        <div className="grid gap-2 sm:grid-cols-2"><NFLProfileMetric label="Overall" value={matchup.overall === 'UNASSESSED' ? 'Partial evidence · not graded' : matchup.overall} /><NFLProfileMetric label="Matchup confidence" value={matchup.confidence} /><NFLProfileMetric label="Defensive state" value={matchup.defensiveState} /><NFLProfileMetric label="Efficiency adjustment" value={`${(matchup.efficiencyAdjustment * 100).toFixed(2)}%`} /><NFLProfileMetric label="Phase 2 → final projection" value={matchup.phase2Projection == null ? null : `${matchup.phase2Projection.toFixed(2)} → ${matchup.finalProjection?.toFixed(2) ?? 'Unavailable'}`} /></div>
        <p className="text-sm text-slate-300">{matchup.playerFit}</p>
        <p className="text-xs text-slate-400">{matchup.adjustmentReason}</p>
        <div><p className="mb-1 text-[10px] font-bold uppercase text-amber-200">Counter-Case</p>{list(matchup.counterCase)}</div>
        <div><p className="mb-1 text-[10px] font-bold uppercase text-slate-400">Missing Matchup Evidence</p>{list(matchup.missingInputs)}</div>
      </div>}
      {scheme?.evidenceSummary && <p className="text-sm text-slate-300">{scheme.evidenceSummary}</p>}<div className="mt-2 grid gap-2 sm:grid-cols-2"><NFLProfileMetric label="Evidence strength" value={scheme?.strength} /><NFLProfileMetric label="Measured sack rate" value={scheme?.sackRate} /><NFLProfileMetric label="Coverage rates" value={Object.keys(scheme?.coverageRates ?? {}).length ? scheme?.coverageRates : null} /><NFLProfileMetric label="How player wins" value={scheme?.playerWinMechanism} /></div>{scheme?.aggregateMetrics.map((metric) => <p key={metric.key} className="mt-2 text-xs text-slate-300">{metric.label}: L3 {show(metric.l3.mean)} ({metric.l3.games}), L5 {show(metric.l5.mean)} ({metric.l5.games}), L10 {show(metric.l10.mean)} ({metric.l10.games}), season {show(metric.season.mean)} ({metric.season.games}) · {metric.trend}</p>)}{!scheme?.aggregateMetrics.length && <div className="mt-2">{list(profile.schemeMatchup.missingFields)}</div>}
    </ResearchRow>
    <ResearchRow title="Trench / Protection" status={nflLayerStatus(profile.trench.status)}>
      {matchup && <div className="mb-2 grid gap-2 sm:grid-cols-2"><NFLProfileMetric label="Trench confidence" value={matchup.trenchEvidence.length ? 'LOW · PARTIAL' : 'UNAVAILABLE'} /><NFLProfileMetric label="Pressure / blitz rate" value={null} /></div>}
      <p className="text-sm text-slate-300">{show(trench?.lineTrenchStatus)} · {show(trench?.lineTrenchImpact)}</p><div className="mt-2">{list(trench?.lineTrenchEvidence)}</div><div className="mt-2">{list(profile.trench.missingFields)}</div>
    </ResearchRow>
    <ResearchRow title="Injury Impact" status={nflLayerStatus(profile.injuryNetwork.status)}>
      {injuries?.length ? <ul className="space-y-2">{injuries.map((item, index) => <li key={`${item.player}-${index}`} className="text-sm text-slate-300">{item.relationship}: {item.player} · {item.position ?? 'position unavailable'} · {item.status} · {item.opportunityImpact ?? 'impact not quantified'}</li>)}</ul> : <p className="text-sm text-slate-500">Unavailable</p>}
      <div className="mt-2">{list(profile.injuryNetwork.missingFields)}</div>
    </ResearchRow>
    <ResearchRow title="Practice Trend" status={nflLayerStatus(profile.practice.status)}>
      {practice?.evidence.length ? <><p className="text-sm text-slate-300">Practice trend: {practice.trend}</p><ul className="mt-2 space-y-1 text-sm text-slate-300">{practice.evidence.map((item) => <li key={`${item.player}-${item.practiceDate}`}>{item.practiceDate}: {item.player} · {item.participation} · {item.source.source}</li>)}</ul></> : <p className="text-sm text-slate-500">{profile.practice.missingFields.join('; ') || 'No dated practice reports available.'}</p>}
    </ResearchRow>
    <ResearchRow title="DeepSide Intelligence" status={nflLayerStatus(profile.intelligence.status)}>
      {profile.intelligence.value?.length ? <ul className="space-y-2">{profile.intelligence.value.map((item, index) => <li key={`${item.source}-${index}`} className="text-sm text-slate-300"><strong>{item.actionability} ACTIONABILITY · {item.reliability} · {item.direction}</strong><p>{item.quoteOrSummary}</p><p className="text-xs text-slate-500">{item.source} · {item.sourceType} · {item.publishedAt ?? 'publication time unavailable'} · {item.affectedPlayer ?? item.affectedTeam ?? 'subject unavailable'}</p>{item.articleUrl && <a href={item.articleUrl} target="_blank" rel="noreferrer" className="text-xs text-emerald-300 underline">Open source</a>}</li>)}</ul> : <p className="text-sm text-slate-500">{profile.intelligence.status === 'AVAILABLE' ? 'No current tagged player/team stories in the seven-day feed.' : profile.intelligence.missingFields.join(', ') || 'Unavailable'}</p>}
      {profile.newsImpactSignals.map((item, index) => <p key={`${item.signal}-${index}`} className="mt-2 text-xs text-slate-300">Impact hook: {item.signal} → {item.affectedPlayers.join(', ')} → {item.affectedMarkets.join(', ')} → {item.projectionImpact ?? 'projection impact pending'} · {item.reEvaluationRequired ? 're-evaluation required' : 'no re-evaluation requested'}</p>)}
    </ResearchRow>
    <ResearchRow title="Market" status={nflLayerStatus(profile.marketIntelligence.status)}>
      <div className="grid gap-2 sm:grid-cols-2"><NFLProfileMetric label="Current pick" value={`${show(market?.direction?.toUpperCase())} ${show(market?.line)}`} /><NFLProfileMetric label="Best current price / book" value={`${show(market?.currentPrice)} / ${show(market?.sportsbook)}`} /><NFLProfileMetric label="DeepSide / implied probability" value={market?.trueProbability == null && market?.impliedProbability == null ? null : `${pct(market?.trueProbability)} / ${pct(market?.impliedProbability)}`} /><NFLProfileMetric label="Edge" value={market?.priceEdge == null ? null : pct(market.priceEdge)} /><NFLProfileMetric label="Observed previous → current line" value={movement?.previousLine == null ? null : `${movement.previousLine} → ${show(movement.currentLine)}`} /><NFLProfileMetric label="Previous → current price" value={movement?.previousPrice == null ? null : `${movement.previousPrice} → ${show(movement.currentPrice)}`} /><NFLProfileMetric label="Movement reason" value={movement?.movementReason === 'UNKNOWN' ? null : movement?.movementReason} /><NFLProfileMetric label="Value remains at current line" value={movement?.valueRemains == null ? null : movement.valueRemains ? 'Yes' : 'No'} /></div>
      {profile.marketIntelligence.missingFields.length > 0 && <p className="mt-2 text-xs text-slate-500">{profile.marketIntelligence.missingFields.join('; ')}. Movement cause is not inferred.</p>}
    </ResearchRow>
    <ResearchRow title="Weather" status={nflLayerStatus(profile.weather.status)}>
      {profile.weather.status === 'NOT_APPLICABLE' ? <p className="text-sm text-slate-400">Indoor venue; no material outdoor weather concern.</p> : <><div className="grid gap-2 sm:grid-cols-2"><NFLProfileMetric label="Venue / roof" value={weather?.venue && weather.roof ? `${weather.venue} / ${weather.roof}` : weather?.venue ?? weather?.roof} /><NFLProfileMetric label="Temperature" value={weather?.temperatureF == null ? null : `${weather.temperatureF}°F`} /><NFLProfileMetric label="Sustained wind / gust" value={weather?.sustainedWindMph == null && weather?.gustMph == null ? null : `${show(weather.sustainedWindMph)} / ${show(weather.gustMph)} mph`} /><NFLProfileMetric label="Precipitation" value={weather?.precipitationInches == null ? null : `${weather.precipitationInches} in`} /></div>{weather?.candidateImpacts.length ? <ul className="mt-2 space-y-1 text-sm text-slate-300">{weather.candidateImpacts.map((impact, index) => <li key={`${impact.market}-${index}`}>{impact.direction}: {impact.statement}</li>)}</ul> : <p className="mt-2 text-xs text-slate-500">{profile.weather.status === 'AVAILABLE' ? 'No material market-specific weather concern.' : profile.weather.missingFields.join('; ')}</p>}</>}
    </ResearchRow>
    <ResearchRow title="Evidence For / Counter-Case" status={profile.verdict === 'PLAY' ? 'STRONG' : 'CAUTION'}>
      <div className="grid gap-4 md:grid-cols-2"><div><p className="mb-2 text-xs font-bold uppercase text-emerald-300">Evidence For</p>{list(profile.evidence.for.map((item) => item.statement))}</div><div><p className="mb-2 text-xs font-bold uppercase text-amber-300">Counter-Case</p>{list(profile.evidence.against.map((item) => item.statement))}</div></div>
      <p className="mt-3 text-sm font-bold text-white">Verdict: {profile.verdict}</p>
      <p className="mt-2 text-xs text-slate-400">Conflict status: {profile.evidence.conflictStatus} · {profile.evidence.resolutionReason ?? 'Resolution pending'}</p>
      {profile.evidence.highestAuthorityEvidence && <p className="mt-1 text-xs text-slate-400">Highest authority: {profile.evidence.highestAuthorityEvidence}</p>}
      {profile.evidence.conflicts.map((conflict, index) => <p key={`${conflict.topic}-${index}`} className="mt-1 text-xs text-slate-300">{conflict.status} · {conflict.topic} · {conflict.resolutionReason}</p>)}
      <div className="mt-2 space-y-1">{gates.map(([key, gate]) => <p key={key} className={`text-xs ${gate.passed ? 'text-emerald-300' : 'text-amber-200'}`}>{gate.passed ? 'PASS' : 'BLOCK'} · {key}{gate.reason ? ` · ${gate.reason}` : ''}</p>)}</div>
    </ResearchRow>
  </div>;
}

function BarMetric({ label, value }: { label: string; value: number }) {
  return <div>
    <div className="mb-1 flex items-center justify-between text-xs"><span className="text-slate-500">{label}</span><span className="font-bold text-white">{value < 0 || !Number.isFinite(value) ? 'Unavailable' : `${value}%`}</span></div>
    <div className="h-2 overflow-hidden rounded-full bg-white/8"><div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-300" style={{ width: `${value < 0 || !Number.isFinite(value) ? 0 : Math.min(100, Math.max(0, value))}%` }} /></div>
  </div>;
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
  const participation = (source?.injuryContext as NFLInjuryContext | undefined)?.participation;
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

  const unavailable = <span className="text-slate-500">Unavailable</span>;
  const riskDetails = d?.howItLoses?.length ? d.howItLoses : selected.riskNotes;
  const risks = isNFL ? riskDetails : riskDetails.slice(0, 4);

  return (
    <div className="overflow-hidden rounded-[1.35rem] border border-emerald-400/20 bg-[#07110d] shadow-[0_18px_80px_rgba(0,0,0,0.35)]">
      {showSelector && <div className="border-b border-white/8 bg-black/20 px-4 py-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">{results.length} recommendation{results.length === 1 ? '' : 's'}</p>
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
                  {source?.pickTier && <div className="rounded-xl border border-white/8 bg-white/[0.025] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className={`text-xs font-black uppercase ${PICK_TIER_STYLES[source.pickTier].label}`}>{source.pickTier} · {source.tierScore ?? a?.researchScore ?? '—'}/100</p>
                      <p className="text-xs text-slate-400">Tier is fixed; query intent changes ranking only.</p>
                    </div>
                    <p className="mt-2 text-sm text-slate-300">{source.tierReason ?? 'Tier reason unavailable.'}</p>
                    {source.pickTier === 'NUKE' && <div className="mt-3 grid gap-1 sm:grid-cols-2">{(source.tierRequirementsPassed ?? []).map((requirement) => <p key={requirement} className="text-xs text-amber-200">✓ {requirement}</p>)}</div>}
                    {source.tierRequirementsFailed?.length ? <div className="mt-3 space-y-1">{source.tierRequirementsFailed.map((requirement) => <p key={requirement} className="text-xs text-slate-400">Not met: {requirement}</p>)}</div> : null}
                  </div>}
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
                  {isNFL && source?.nflResearchProfile && <NFLResearchProfileDetails profile={source.nflResearchProfile} />}
                </div>
              )}

              {activeResearchTab === 'research' && (
                <div className="space-y-4">
                  {isNFL && source?.nflResearchProfile && <NFLResearchProfileDetails profile={source.nflResearchProfile} />}
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
                  {participation && <NFLParticipationSummary verdict={participation} />}
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
                  {isNFL && source?.nflHistory && <NFLHistorySummary history={source.nflHistory} />}
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
  const [finderSport, setFinderSport] = useState(() => {
    const sport = searchParams.get('sport')?.toLowerCase();
    return sport === 'nfl' ? 'NFL' : sport === 'nba' ? 'NBA' : 'MLB';
  });
  const [finderDate, setFinderDate] = useState(() => resolveSlateDate(searchParams.get('date')));
  const [mode, setMode] = useState<SearchMode>("quick");
  const [query, setQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [criteria, setCriteria] = useState<AiSearchCriteria | null>(null);
  const [results, setResults] = useState<UiAiResult[]>([]);
  const [gameResults, setGameResults] = useState<GameRecommendation[]>([]);
  const [modeledGames, setModeledGames] = useState<ModeledGameResearch[]>([]);
  const [nbaPresentation, setNbaPresentation] = useState<NBAClientPresentation | null>(null);
  const [ledgerReceipt, setLedgerReceipt] = useState<string | null>(null);
  const [ledgerCaptureIssue, setLedgerCaptureIssue] = useState<string | null>(null);
  const acknowledgedReceipt = useRef<string | null>(null);
  const [closestMisses, setClosestMisses] = useState<UiAiResult[]>([]);
  const [selectedPlayIndex, setSelectedPlayIndex] = useState<number | null>(null);
  const [selectionResultCount, setSelectionResultCount] = useState(results.length);
  if (selectionResultCount !== results.length) {
    setSelectionResultCount(results.length);
    setSelectedPlayIndex(null);
  }
  const [totalMatched, setTotalMatched] = useState(0);
  const [showCount, setShowCount] = useState(15);
  const [conversation, setConversation] = useState<Array<{ role: "user" | "ai"; text: string }>>([]);
  const [toolTrace, setToolTrace] = useState<AgentToolTrace[]>([]);
  const [agentMeta, setAgentMeta] = useState<Record<string, unknown> | null>(null);
  const [researchSessionId, setResearchSessionId] = useState<string | null>(null);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [researchScope, setResearchScope] = useState<{ label: string; games: number | null } | null>(null);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [restrictionMessage, setRestrictionMessage] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!ledgerReceipt || finderSport !== 'NFL' || !results.length || acknowledgedReceipt.current === ledgerReceipt) return;
    const candidateIds = results.map((result) => result.sourceRecord?.candidateId).filter((id): id is string => typeof id === 'string');
    if (!candidateIds.length) return;
    acknowledgedReceipt.current = ledgerReceipt;
    fetch('/api/nfl/ledger/capture', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ receipt: ledgerReceipt, candidateIds }) }).then((response) => {
        if (!response.ok) setLedgerCaptureIssue('This displayed NFL recommendation could not be saved to the forward track record.');
      }).catch(() => setLedgerCaptureIssue('This displayed NFL recommendation could not be saved to the forward track record.'));
  }, [finderSport, ledgerReceipt, results]);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const comparePanelRef = useRef<HTMLDivElement>(null);
  const [deepSummary, setDeepSummary] = useState<FinderRunSummary | null>(null);
  const [deepSummarySport, setDeepSummarySport] = useState<string | null>(null);
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
  // Keep ?sport=/?date= in the URL in sync with the Finder selectors.
  useEffect(() => {
    if (!sessionRestored) return;
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    const nextSport = finderSport === 'NFL' ? 'nfl' : finderSport === 'NBA' ? 'nba' : 'mlb';
    if (params.get('sport') === nextSport && params.get('date') === finderDate) return;
    params.set('sport', nextSport);
    params.set('date', finderDate);
    router.replace(`/ai?${params.toString()}`, { scroll: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finderSport, finderDate, sessionRestored]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
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
        restore(() => { if (saved.sport === 'MLB' || saved.sport === 'NFL' || saved.sport === 'NBA') setFinderSport(saved.sport); });
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
    }
    });
    return () => { cancelled = true; };
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
    if (!isSearching) return;
    const startedAt = Date.now();
    const id = window.setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [isSearching]);

  // ── search ──────────────────────────────────────────────────────────────────
  // The OpenAI agent orchestrates the research server-side; the deterministic Elite Filter
  // still decides qualification, and results render through the existing DeepSide cards.
  async function runSearch(q: string, appendUser = true) {
    if (!q.trim()) return;
    setNbaPresentation(null);
    setGameResults([]);
    setModeledGames([]);
    setLedgerReceipt(null);
    setLedgerCaptureIssue(null);
    sessionClearedRef.current = false;
    const trimmed = q.trim();
    setIsSearching(true);
    setElapsedSeconds(0);
    setShowCount(15);
    setSelectedIds(new Set());
    void loadResearchScope(trimmed);

    const history: ConversationEntry[] = appendUser ? [...conversation, { role: "user", text: trimmed }] : conversation.filter((entry, index) => !(index === conversation.length - 1 && entry.role === 'ai'));
    if (appendUser) {
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
          context: { sport: finderSport.toLowerCase(), date: finderDate },
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
    setLedgerReceipt(payload.ledgerReceipt ?? null);
    const responseSport = String(payload.meta?.sport ?? finderSport).toLowerCase();
    if (responseSport === 'nfl' && (payload.results?.length ?? 0) > 0 && !payload.ledgerReceipt) {
      setLedgerCaptureIssue('This displayed NFL recommendation was not tracked because a signed ledger receipt is unavailable.');
    }
    // Follow-up turns that only read stored memory (get_closest_misses etc.) return no meta —
    // keep showing the last real analysis instead of blanking the panel.
    if (payload.meta) setAgentMeta(payload.meta);
    if (payload.researchSessionId !== undefined) setResearchSessionId(payload.researchSessionId);

    const meta = payload.meta ?? {};
    const sportLabel = String(meta.sport ?? finderSport).toUpperCase();
    const sport = sportLabel === 'NFL' ? 'NFL' : sportLabel === 'NBA' ? 'NBA' : 'MLB';
    const requestDate = typeof meta.date === "string" ? meta.date : finderDate;
    if (requestDate !== finderDate) setFinderDate(requestDate);
    if (sport !== finderSport) setFinderSport(sport);

    setConversation((prev) => [...prev, { role: "ai", text: payload.reply }]);
    if (sport === 'NBA' && payload.nbaPresentation?.schemaVersion === 'deepside-nba-pick-presentation/1') {
      setNbaPresentation(payload.nbaPresentation);
      setResults([]);
      setGameResults([]);
      setModeledGames([]);
      setClosestMisses([]);
      setTotalMatched(payload.nbaPresentation.recommendedCandidateIds?.length ?? 0);
      setFinderStatus(payload.nbaPresentation.picks.length > 0 ? 'RESULTS' : 'NO_ELITE_RESULTS');
      setIsSearching(false);
      return;
    }
    const responseGames = (payload.results ?? []).filter((record): record is GameRecommendation => 'recommendationType' in record && record.recommendationType === 'GAME');
    const responseProps = (payload.results ?? []).filter((record): record is AgentResultRecord => !('recommendationType' in record) || record.recommendationType !== 'GAME');
    setGameResults(responseGames);
    setModeledGames(payload.modeledGames ?? []);

    if ((payload.results ?? []).length > 0) {
      const structuredResults = responseProps.filter((record) => (record.pickTier != null || record.eliteQualified) && record.odds != null && record.odds >= -900).slice(0, 15).map((record) => recordToUiResult(record, sport));
      setTotalMatched(structuredResults.length + responseGames.length);
      setResults(structuredResults);
      setClosestMisses([]);
      setFinderStatus(structuredResults.length + responseGames.length > 0 ? 'RESULTS' : 'NO_ELITE_RESULTS');
      setIsSearching(false);
      return;
    }

    setResults([]);
    setTotalMatched(0);
    setClosestMisses((payload.closestMisses ?? []).slice(0, 5).map((record) => closestMissToUiResult(record, sport)));

    const trace = payload.toolTrace ?? [];
    const lastLoad = [...trace].reverse().find((entry) => entry.name === 'get_sportsbook_candidates');
    const ranSearch = trace.some((entry) => SEARCH_TOOLS.has(entry.name));
    const outcome = meta.researchComplete === false ? 'RESEARCH_INCOMPLETE' as const : meta.status === 'SLATE_COMPLETE' ? 'SLATE_COMPLETE' as const : meta.status === 'NOT_FOUND' ? 'CLARIFY' as const : lastLoad && lastLoad.status !== 'SUCCESS'
      ? classifyLoadFailure(lastLoad.status)
      : ranSearch || meta.researchComplete === true ? 'NO_ELITE_RESULTS' as const
        : payload.reply.trim().endsWith('?') && trace.length === 0 ? 'CLARIFY' as const : 'ANSWER' as const;
    if (outcome === 'DATA_UNAVAILABLE' || outcome === 'CONNECTION_ERROR') {
      console.warn('[DeepSide AI]', lastLoad?.status, lastLoad?.summary?.error ?? '');
    }
    setFinderStatus(outcome);
    setIsSearching(false);
  }

  function handleSubmit() {
    if (query.trim()) runSearch(query);
  }

  /** Real scope for the loading card: same date/sport resolver as the server, plus the free schedule. */
  async function loadResearchScope(text: string) {
    const sport = detectSport(text);
    const resolved = resolveDateFromText(text);
    if (!sport || (sport !== 'nfl' && sport !== 'mlb')) {
      setResearchScope(resolved ? { label: resolved.displayDate, games: null } : null);
      return;
    }
    const date = resolved?.resolvedDate ?? todaySlateDate();
    const label = `${sport.toUpperCase()} • ${resolved?.displayDate ?? formatDisplayDate(date)}`;
    setResearchScope({ label, games: null });
    try {
      const response = await fetch(`/api/${sport}/schedule?date=${date}`);
      const payload = response.ok ? await response.json() as { data?: Array<{ completed?: boolean; status?: string }> } : null;
      const games = (payload?.data ?? []).filter((game) => !game.completed && !/final|completed|postponed|cancell?ed/i.test(game.status ?? '')).length;
      setResearchScope((current) => current?.label === label ? { label, games } : current);
    } catch { /* the label alone is still accurate */ }
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
    setNbaPresentation(null);
    setGameResults([]);
    setModeledGames([]);
    setTotalMatched(0);
    setFinderStatus('IDLE');
    setShowCount(15);
    setConversation([]);
    setSelectedIds(new Set());
    setDeepSummary(null);
    setDeepSummarySport(null);
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
  const tierCounts = results.reduce<Partial<Record<PickTier, number>>>((counts, result) => {
    const tier = result.sourceRecord?.pickTier ?? (result.sourceRecord?.eliteQualified ? 'ELITE' : 'PASS');
    counts[tier] = (counts[tier] ?? 0) + 1;
    return counts;
  }, {});

  const lastUserQuery = [...conversation].reverse().find((entry) => entry.role === 'user')?.text ?? '';
  const latestAiReply = conversation[conversation.length - 1]?.role === 'ai' ? conversation[conversation.length - 1].text : '';
  const datePreset = presetForSlateDate(finderDate);
  const slateLabel = `${finderSport} • ${datePreset === 'today' ? 'Today' : datePreset === 'tomorrow' ? 'Tomorrow' : new Date(`${finderDate}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}`;
  const coverage = typeof agentMeta?.gamesFound === 'number' && typeof agentMeta?.gamesScheduled === 'number' && agentMeta.gamesScheduled > 0
    ? { researched: agentMeta.gamesFound, expected: agentMeta.gamesScheduled }
    : null;
  const nflLedger = finderSport === 'NFL' ? agentMeta?.nflLedger as NFLSlateLedger | undefined : undefined;
  const keyFindings = useMemo(() => {
    if (results.length === 0) return [];
    const findings = [`${results.length} play${results.length === 1 ? '' : 's'} passed DeepSide's qualification filter`];
    const marketCounts = new Map<string, number>();
    for (const result of results) marketCounts.set(result.prop.propType, (marketCounts.get(result.prop.propType) ?? 0) + 1);
    const [topMarket, topCount] = [...marketCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (results.length > 1 && topCount > 1) findings.push(`Strongest market: ${topMarket} (${topCount} of ${results.length})`);
    const top = [...results].sort((a, b) => b.matchScore - a.matchScore)[0];
    findings.push(`Highest research score: ${top.prop.player} (${top.eliteResearch?.researchScore ?? top.matchScore})`);
    return findings;
  }, [results]);

  function focusSearchInput() {
    inputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    inputRef.current?.focus();
    inputRef.current?.select();
  }

  function startNewSearch() {
    resetSearchSession();
    focusSearchInput();
  }

  function adjustSearch() {
    setQuery(lastUserQuery);
    focusSearchInput();
  }

  function retryLastSearch() {
    if (lastUserQuery) void runSearch(lastUserQuery, false);
  }

  const analysisChips = ([
    ['sport', 'Sport'], ['date', 'Slate'], ['gamesFound', 'Games'],
    ['propsFound', 'Props'], ['booksFound', 'Books'], ['candidatesFound', 'Candidates'], ['recommendedFound', 'Recommended'],
  ] as const)
    .filter(([key]) => agentMeta?.[key] !== undefined && agentMeta?.[key] !== null)
    .map(([key, label]) => ({ label, value: String(agentMeta?.[key]) }));

  return (
    <div className="relative flex h-screen overflow-hidden bg-[#02040a] p-0 md:p-3 text-white">
      <FuturisticBackground />
      <div className="relative flex h-full w-full overflow-hidden md:rounded-[24px] md:border md:border-white/[0.08] md:shadow-[0_0_50px_rgba(0,0,0,0.85)]">
        <AppSidebar currentPath="/ai" footer={sidebarFooter} />

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* ── Top nav ── */}
          <header className={`flex shrink-0 items-center justify-between px-4 py-3 sm:px-6 transition-all ${
            conversation.length === 0 && !isSearching
              ? 'bg-transparent border-b border-transparent'
              : 'border-b border-white/[0.06] bg-[#030612]/80 backdrop-blur-md'
          }`}>
            <div className="flex items-center gap-2">
              {(conversation.length > 0 || isSearching || results.length > 0) ? (
                <div className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-1.5 text-xs text-slate-400">
                  <svg className="h-3.5 w-3.5 shrink-0 text-cyan-400" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} viewBox="0 0 24 24"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                  <span className="font-medium text-slate-300">DeepSide AI</span>
                </div>
              ) : null}
            </div>

            <div className="ml-auto flex items-center gap-2">
              {(conversation.length > 0 || isSearching || results.length > 0) && (
                <>
                  <div className="hidden sm:flex shrink-0 items-center gap-1 rounded-xl border border-white/8 bg-white/[0.03] p-1 text-xs font-medium">
                    <button onClick={() => setFinderSport('MLB')} className={`rounded-lg px-2.5 py-1 transition ${finderSport === 'MLB' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-slate-400 hover:text-white'}`}>⚾ MLB</button>
                    <button onClick={() => setFinderSport('NBA')} className={`rounded-lg px-2.5 py-1 transition ${finderSport === 'NBA' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-slate-400 hover:text-white'}`}>NBA</button>
                    <button onClick={() => setFinderSport('NFL')} className={`rounded-lg px-2.5 py-1 transition ${finderSport === 'NFL' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-slate-400 hover:text-white'}`}>NFL</button>
                  </div>
                  <div className="hidden sm:flex shrink-0 items-center gap-1 rounded-xl border border-white/8 bg-white/[0.03] p-1 text-xs font-medium">
                    <button onClick={() => setFinderDate(todaySlateDate())} className={`rounded-lg px-2.5 py-1 transition ${presetForSlateDate(finderDate) === 'today' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-slate-400 hover:text-white'}`}>Today</button>
                    <button onClick={() => setFinderDate(tomorrowSlateDate())} className={`rounded-lg px-2.5 py-1 transition ${presetForSlateDate(finderDate) === 'tomorrow' ? 'bg-cyan-500/20 text-cyan-300 font-semibold' : 'text-slate-400 hover:text-white'}`}>Tomorrow</button>
                  </div>
                  <button onClick={resetSearchSession} title="Clear the saved DeepSide AI session" className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-2.5 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10">Reset</button>
                </>
              )}

              {/* Notification bell matching reference image */}
              <button
                type="button"
                title="Notifications"
                className="relative flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-slate-300 transition hover:border-cyan-400/50 hover:text-white"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                </svg>
                <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_8px_#f59e0b]" />
              </button>
            </div>
          </header>

        <main className="min-w-0 flex-1 overflow-y-auto pb-20 md:pb-6">
          <div className={`flex min-w-0 gap-3 p-3 sm:gap-5 sm:p-5 ${criteria ? "" : "min-h-full items-center justify-center"}`}>

            {/* ── Center column ── */}
            <div className="flex min-w-0 flex-1 flex-col gap-5">

              {/* DeepSide AI hero matching reference image */}
              {conversation.length === 0 && !isSearching && (
                <div className="mx-auto flex w-full max-w-[760px] flex-1 flex-col items-center justify-center pb-6 pt-6 sm:pt-14 text-center">
                  <DeepSideLogo size="hero" showTagline={true} />

                  {/* ── Search Bar matching reference image ── */}
                  <div className="mt-8 w-full">
                    <div className="relative flex h-14 sm:h-[58px] items-center rounded-full border border-[#00b4d8]/70 bg-[#050b18]/85 px-3 sm:px-4 shadow-[0_0_25px_rgba(0,180,216,0.3),inset_0_0_12px_rgba(0,180,216,0.08)] backdrop-blur-xl focus-within:border-[#38bdf8] focus-within:shadow-[0_0_35px_rgba(56,189,248,0.45)] transition-all">
                      <svg className="h-5 w-5 shrink-0 text-slate-400 ml-2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                        <circle cx="11" cy="11" r="8" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                      <input
                        ref={inputRef as unknown as React.RefObject<HTMLInputElement>}
                        type="text"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleSubmit();
                          }
                        }}
                        placeholder="Ask anything..."
                        className="min-w-0 flex-1 bg-transparent px-3 text-sm sm:text-base text-white outline-none placeholder:text-slate-400 font-normal"
                      />
                      <button
                        onClick={handleSubmit}
                        disabled={isSearching || !query.trim()}
                        aria-label="Search"
                        title="Search with DeepSide AI"
                        className="flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-[#0284c7] via-[#0ea5e9] to-[#38bdf8] text-white shadow-[0_0_20px_rgba(14,165,233,0.85)] search-button-glow transition hover:scale-105 active:scale-95 disabled:opacity-50 disabled:shadow-none disabled:cursor-not-allowed disabled:scale-100"
                      >
                        <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                          <line x1="5" y1="12" x2="19" y2="12" />
                          <polyline points="12 5 19 12 12 19" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* ── Feature Cards matching reference image ── */}
                  <div className="mt-6 grid w-full grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5">
                    {/* Card 1: AI Favorites */}
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("Show me 5 high confidence MLB props 80%+");
                        runSearch("Show me 5 high confidence MLB props 80%+");
                      }}
                      className="group relative flex items-center justify-between rounded-2xl border border-[#00b4d8]/65 bg-gradient-to-b from-[#0b172d]/90 to-[#040916]/95 p-4 sm:p-5 text-left backdrop-blur-md shadow-[0_0_25px_rgba(0,180,216,0.22),inset_0_0_15px_rgba(0,180,216,0.06)] hover:border-[#38bdf8] hover:shadow-[0_0_35px_rgba(56,189,248,0.4)] transition-all cursor-pointer"
                    >
                      <div className="flex items-center gap-3.5 sm:gap-4 min-w-0">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#00b4d8]/50 bg-[#071936]/80 text-cyan-300 shadow-[0_0_12px_rgba(0,180,216,0.35)] group-hover:border-[#38bdf8] group-hover:text-cyan-200 transition">
                          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                            <rect x="4" y="3" width="16" height="18" rx="2" />
                            <line x1="8" y1="8" x2="16" y2="8" />
                            <line x1="8" y1="12" x2="16" y2="12" />
                            <line x1="8" y1="16" x2="12" y2="16" />
                          </svg>
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-base sm:text-[17px] font-bold tracking-tight text-white group-hover:text-cyan-100 transition">AI Favorites</h3>
                          <p className="text-xs text-slate-300/80 truncate">Your saved picks and top targets.</p>
                        </div>
                      </div>
                      <svg className="h-5 w-5 shrink-0 text-slate-400 group-hover:text-cyan-300 transition-colors ml-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>

                    {/* Card 2: Best +EV Plays */}
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("Find me 15 plus-money MLB value plays");
                        runSearch("Find me 15 plus-money MLB value plays");
                      }}
                      className="group relative flex items-center justify-between rounded-2xl border border-[#eab308]/65 bg-gradient-to-b from-[#1c1608]/90 to-[#0a0702]/95 p-4 sm:p-5 text-left backdrop-blur-md shadow-[0_0_25px_rgba(234,179,8,0.22),inset_0_0_15px_rgba(234,179,8,0.06)] hover:border-[#fde047] hover:shadow-[0_0_35px_rgba(234,179,8,0.4)] transition-all cursor-pointer"
                    >
                      <div className="flex items-center gap-3.5 sm:gap-4 min-w-0">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#eab308]/50 bg-[#2b1f07]/80 text-amber-300 shadow-[0_0_12px_rgba(234,179,8,0.35)] group-hover:border-[#fde047] group-hover:text-amber-200 transition">
                          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="18" y1="20" x2="18" y2="9" />
                            <line x1="12" y1="20" x2="12" y2="4" />
                            <line x1="6" y1="20" x2="6" y2="14" />
                          </svg>
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-base sm:text-[17px] font-bold tracking-tight text-white group-hover:text-amber-100 transition">Best +EV Plays</h3>
                          <p className="text-xs text-amber-100/70 truncate">Highest value opportunities.</p>
                        </div>
                      </div>
                      <svg className="h-5 w-5 shrink-0 text-amber-400/80 group-hover:text-amber-300 transition-colors ml-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  </div>

                  {/* Secondary suggestions */}
                  <div className="flex flex-wrap justify-center gap-2 pt-5">
                    {SECONDARY_SUGGESTIONS.map((s) => (
                      <button
                        key={s.label}
                        onClick={() => {
                          setQuery(s.query);
                          runSearch(s.query);
                        }}
                        className="rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-1.5 text-xs text-slate-400 transition hover:border-[#00b4d8]/50 hover:bg-[#00b4d8]/10 hover:text-cyan-300"
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Search when in conversation or results state ── */}
              {(conversation.length > 0 || isSearching || results.length > 0) && (
                <div className="mx-auto w-full max-w-[900px]">
                  <div className="relative flex h-13 items-center rounded-full border border-[#00b4d8]/65 bg-[#050b18]/85 px-4 shadow-[0_0_20px_rgba(0,180,216,0.2)] backdrop-blur-xl focus-within:border-[#38bdf8] focus-within:shadow-[0_0_30px_rgba(56,189,248,0.35)] transition-all">
                    <svg className="h-4 w-4 shrink-0 text-slate-400 ml-1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                      <circle cx="11" cy="11" r="8" />
                      <line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSubmit();
                        }
                      }}
                      placeholder="Ask anything..."
                      className="min-w-0 flex-1 bg-transparent px-3 text-sm text-white outline-none placeholder:text-slate-400 font-normal"
                    />
                    <button
                      onClick={handleSubmit}
                      disabled={isSearching || !query.trim()}
                      aria-label="Search"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-tr from-[#0284c7] via-[#0ea5e9] to-[#38bdf8] text-white shadow-[0_0_15px_rgba(14,165,233,0.85)] search-button-glow transition hover:scale-105 active:scale-95 disabled:opacity-50"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" viewBox="0 0 24 24">
                        <line x1="5" y1="12" x2="19" y2="12" />
                        <polyline points="12 5 19 12 12 19" />
                      </svg>
                    </button>
                  </div>
                  {agentError && process.env.NODE_ENV !== 'production' && (
                    <div className="mt-4 rounded-2xl border border-amber-500/25 bg-amber-500/8 p-4 text-left">
                      <p className="text-sm font-semibold text-amber-200">AI research agent unavailable</p>
                      <p className="mt-1 text-xs text-amber-200/80">{agentError}</p>
                    </div>
                  )}
                </div>
              )}

              {/* ── Loading animation ── */}
              {isSearching && (
                <div className="space-y-3">
                  {(lastUserQuery || query) && (
                    <div className="flex justify-end">
                      <p className="max-w-[85%] rounded-2xl rounded-br-md border border-white/8 bg-white/5 px-4 py-2.5 text-sm text-slate-200">{lastUserQuery || query}</p>
                    </div>
                  )}
                  <div className="rounded-2xl border border-cyan-400/25 bg-cyan-950/20 p-4 shadow-[0_0_20px_rgba(0,180,216,0.15)]" role="status" aria-live="polite">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-400" />
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-300">DeepSide AI is researching</p>
                    </div>
                    {researchScope && <p className="mt-2 text-base font-bold text-white">{researchScope.label}</p>}
                    <p className="mt-1 text-sm text-slate-300">{researchScope?.games != null ? `Analyzing ${researchScope.games} game${researchScope.games === 1 ? '' : 's'} — loading sportsbook markets, researching candidates and applying DeepSide filters…` : 'Loading sportsbook markets, researching candidates and applying DeepSide filters…'}</p>
                    <p className="mt-1 text-xs text-slate-500">{elapsedSeconds}s elapsed · complete slates can take a minute</p>
                  </div>
                </div>
              )}

              {/* ── Results ── */}
              {!isSearching && (conversation.length > 0 || results.length > 0 || finderStatus !== 'IDLE') && (
                <div className="space-y-4">

                  {/* User query, then a state-specific research card — never raw tool/status codes. */}
                  {lastUserQuery && (
                    <div className="flex justify-end">
                      <p className="max-w-[85%] rounded-2xl rounded-br-md border border-white/8 bg-white/5 px-4 py-2.5 text-sm text-slate-200">{lastUserQuery}</p>
                    </div>
                  )}

                  {(finderStatus === 'RESULTS' || finderStatus === 'NO_ELITE_RESULTS') && (
                    <div className="rounded-2xl border border-white/8 bg-white/3 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">✓ Research Complete</p>
                          <p className="mt-1 text-base font-bold text-white">{slateLabel}</p>
                        </div>
                        <button onClick={startNewSearch} className="min-h-9 shrink-0 rounded-xl border border-white/10 px-3 text-xs font-semibold text-slate-300 hover:text-white">New Search</button>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                        {nflLedger ? <NFLSlateSummary ledger={nflLedger} /> : coverage && (
                          <span className="text-slate-300">
                            <span className="font-bold text-white">{coverage.researched} / {coverage.expected}</span> games researched
                            {coverage.researched < coverage.expected && <span className="text-amber-300"> · {coverage.expected - coverage.researched} unavailable</span>}
                          </span>
                        )}
                        {finderStatus === 'RESULTS' && <span className={`font-semibold ${agentMeta?.includePasses === true ? 'text-rose-200' : 'text-emerald-300'}`}>
                          {nbaPresentation?.recommendedCandidateIds?.length ?? results.length + gameResults.length} {agentMeta?.includePasses === true ? 'PASS candidate' : 'recommended play'}{(nbaPresentation?.recommendedCandidateIds?.length ?? results.length + gameResults.length) === 1 ? '' : 's'}
                        </span>}
                      </div>
                      {finderSport === 'NBA' && typeof agentMeta?.unsupportedMarketNotice === 'string'
                        && <p role="status" className="mt-3 border-l-2 border-amber-300 px-3 py-2 text-xs leading-relaxed text-amber-100">{agentMeta.unsupportedMarketNotice}</p>}
                      {finderStatus === 'RESULTS' && <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Recommendation counts by tier">
                        {(['NUKE', 'ELITE', 'SHARP', 'EDGE', 'LEAN', ...(agentMeta?.includePasses === true ? ['PASS' as const] : [])] as const).filter((tier) => (tierCounts[tier] ?? 0) > 0).map((tier) => (
                          <span key={tier} className={`rounded-full border px-2 py-1 text-[10px] font-bold ${PICK_TIER_STYLES[tier].badge}`}>{tier} {tierCounts[tier]}</span>
                        ))}
                      </div>}
                      {finderStatus === 'NO_ELITE_RESULTS' && (
                        <div className="mt-4 border-t border-white/6 pt-4">
                          <p className="text-sm font-black uppercase tracking-[0.14em] text-white">No recommendable plays</p>
                          <p className="mt-1 text-sm text-slate-400">DeepSide found no plays that passed publication gates and the requested quality floor.</p>
                          <button onClick={adjustSearch} className="mt-3 min-h-10 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 text-sm font-semibold text-emerald-300">Adjust Search</button>
                        </div>
                      )}
                    </div>
                  )}

                  {finderStatus === 'NO_ELITE_RESULTS' && closestMisses.length > 0 && (
                    <section className="space-y-3">
                      <div className="rounded-xl border border-amber-400/25 bg-amber-400/8 px-4 py-3">
                        <p className="text-sm font-black uppercase tracking-[0.14em] text-amber-200">Closest Misses</p>
                        <p className="mt-1 text-xs text-amber-100/70">Nearest to DeepSide&apos;s requirements. Not official picks.</p>
                      </div>
                      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                        {closestMisses.map((result, index) => (
                          <StructuredPickCard key={result.prop.id} result={result} index={index} expanded={false} selectedForCompare={false} onToggle={() => {}} onCompare={() => {}} />
                        ))}
                      </div>
                    </section>
                  )}

                  {(finderStatus === 'DATA_UNAVAILABLE' || finderStatus === 'SPORTSBOOK_UNAVAILABLE') && (
                    <div className="rounded-2xl border border-amber-400/25 bg-amber-400/5 p-5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">Data Unavailable</p>
                      <p className="mt-1 text-base font-bold text-white">{slateLabel}</p>
                      <p className="mt-3 text-sm text-slate-300">Sportsbook data isn&apos;t available for this slate yet.</p>
                      <p className="mt-1 text-sm text-slate-400">Try another date or check again when markets are available.</p>
                      <button onClick={adjustSearch} className="mt-4 min-h-10 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 text-sm font-semibold text-amber-200">Try Another Date</button>
                    </div>
                  )}

                  {finderStatus === 'RESEARCH_INCOMPLETE' && (
                    <section className="space-y-3 border-t border-amber-400/25 py-4">
                      <p className="text-sm font-bold text-amber-200">Research Incomplete</p>
                      <p className="text-base font-bold text-white">{slateLabel}</p>
                      <p className="text-sm text-slate-300">{nflLedger && nflLedger.eligiblePregame > 0 && nflLedger.retrievedGames === nflLedger.eligiblePregame && nflLedger.zeroMarketGames === nflLedger.eligiblePregame && nflLedger.failedGames === 0 && nflLedger.notFetchedGames === 0
                        ? 'Sportsbook player-prop markets have not been posted for this slate yet.'
                        : 'Required sportsbook market data is currently unavailable.'}</p>
                      <p className="text-sm text-slate-400">DeepSide will not issue Elite Picks until the required markets and research evidence are available.</p>
                      {nflLedger && <NFLSlateSummary ledger={nflLedger} />}
                    </section>
                  )}

                  {finderStatus === 'TEMP_UNAVAILABLE' && (
                    <div className="rounded-2xl border border-amber-400/25 bg-amber-400/5 p-5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-300">Sportsbook Data Temporarily Unavailable</p>
                      <p className="mt-1 text-base font-bold text-white">{slateLabel}</p>
                      <p className="mt-3 text-sm text-slate-300">DeepSide couldn&apos;t retrieve the latest markets for this search.</p>
                      <p className="mt-1 text-sm text-slate-400">Please try again shortly.</p>
                      <button onClick={retryLastSearch} className="mt-4 min-h-10 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 text-sm font-semibold text-amber-200">Try Again</button>
                    </div>
                  )}

                  {(finderStatus === 'CONNECTION_ERROR' || finderStatus === 'ERROR') && (
                    <div className="rounded-2xl border border-rose-400/25 bg-rose-400/5 p-5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-rose-300">⚠ Data Connection Issue</p>
                      <p className="mt-2 text-sm text-slate-300">DeepSide couldn&apos;t load the sportsbook data needed for this search.</p>
                      {process.env.NODE_ENV !== 'production' && agentError && <p className="mt-2 font-mono text-[10px] text-slate-500">[dev] {agentError}</p>}
                      <button onClick={retryLastSearch} className="mt-4 min-h-10 rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 text-sm font-semibold text-rose-200">Try Again</button>
                    </div>
                  )}

                  {finderStatus === 'SLATE_COMPLETE' && (
                    <div className="rounded-2xl border border-white/8 bg-white/3 p-5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Slate Complete</p>
                      <p className="mt-1 text-base font-bold text-white">{slateLabel}</p>
                      <p className="mt-3 text-sm text-slate-400">Every game on this slate has finished, so props are no longer offered.</p>
                      <button onClick={adjustSearch} className="mt-4 min-h-10 rounded-xl border border-white/10 px-4 text-sm font-semibold text-slate-200">Try Another Date</button>
                    </div>
                  )}

                  {(finderStatus === 'CLARIFY' || finderStatus === 'ANSWER') && latestAiReply && (
                    <div className="rounded-2xl border border-white/8 bg-white/3 p-5">
                      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-300">{finderStatus === 'CLARIFY' ? 'One Quick Question' : 'DeepSide AI'}</p>
                      <StructuredAnswer text={latestAiReply} />
                    </div>
                  )}

                  {selectedIds.size >= 2 && (
                    <button onClick={() => comparePanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} className="min-h-10 w-full rounded-xl bg-teal-500 px-3 text-sm font-bold text-slate-950 hover:bg-teal-400 sm:w-auto">
                      Compare {selectedIds.size} Plays
                    </button>
                  )}

                  {/* Result cards */}
                  {finderSport === 'NBA' && nbaPresentation && <NBAPresentationCards presentation={nbaPresentation} />}
                  {modeledGames.length > 0 && <section className="space-y-3 border-t border-white/10 pt-4">
                    <h2 className="text-xs font-bold uppercase text-slate-400">Team research · Not a recommendation</h2>
                    <div className="grid grid-cols-1 gap-x-6 xl:grid-cols-2">{modeledGames.filter(record => !gameResults.some(game => game.gameId === record.gameId)).map(record => <NBAModeledGameResearch key={record.gameId} record={record} />)}</div>
                  </section>}
                  {results.length + gameResults.length > 0 && (
                    <>
                      {finderSport === 'NFL' && ledgerCaptureIssue && <p role="status" className="border-l-2 border-amber-300 px-3 py-2 text-xs text-amber-100">{ledgerCaptureIssue}</p>}
                      <h2 className="pt-1 text-xs font-black uppercase tracking-[0.2em] text-slate-400">{agentMeta?.includePasses === true ? 'Rejected Candidates' : 'Recommendations'}</h2>
                      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
                        {[...visibleResults.map((result, index) => ({ rank: result.sourceRecord?.rank ?? index + 1, prop: result, index })),
                          ...gameResults.map(game => ({ rank: game.rank, game }))].sort((first, second) => first.rank - second.rank).map(entry => 'game' in entry
                          ? <NBAGameRecommendationCard key={entry.game.candidateId} record={entry.game} /> : (
                          <StructuredPickCard
                            key={entry.prop.prop.id}
                            result={entry.prop}
                            index={entry.rank - 1}
                            expanded={selectedPlayIndex === entry.index}
                            selectedForCompare={selectedIds.has(entry.prop.prop.id)}
                            onToggle={() => setSelectedPlayIndex((selected) => selected === entry.index ? null : entry.index)}
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
                      {keyFindings.length > 0 && (
                        <section className="rounded-2xl border border-white/8 bg-white/3 p-4">
                          <h2 className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Key Findings</h2>
                          <ul className="mt-2 space-y-1.5 text-sm text-slate-300">
                            {keyFindings.map((finding) => <li key={finding} className="flex gap-2"><span className="text-emerald-400">•</span><span>{finding}</span></li>)}
                          </ul>
                        </section>
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
            {(conversation.length > 0 || isSearching || results.length > 0) && (
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

                {/* Last analysis */}
                {analysisChips.length > 0 && (
                  <div className="rounded-2xl border border-teal-500/15 bg-teal-500/5 p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-white">Last Analysis</h3>
                      <button onClick={() => { setResults([]); setNbaPresentation(null); setToolTrace([]); }} className="text-[10px] text-slate-500 hover:text-white">Clear</button>
                    </div>
                    <div className="space-y-1">
                      {analysisChips.map(({ label, value }) => (
                        <div key={label} className="flex items-center justify-between text-[10px]">
                          <span className="text-slate-500">{label}</span>
                          <span className="font-semibold text-teal-400">{value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </aside>
            )}
          </div>
        </main>
      </div>
      </div>

      {/* Mobile Bottom Navigation Bar */}
      <MobileBottomNav currentPath="/ai" />
    </div>
  );
}
