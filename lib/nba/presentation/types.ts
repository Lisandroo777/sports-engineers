export const PICK_PRESENTATION_SCHEMA_VERSION = 'deepside-nba-pick-presentation/1' as const;

export const PRESENTATION_TIERS = ['NUKE', 'ELITE', 'SHARP', 'EDGE', 'LEAN', 'PASS'] as const;
export type PresentationTier = typeof PRESENTATION_TIERS[number];
export type PresentationSort = 'BEST' | 'MOST_LIKELY' | 'BEST_VALUE';
export type PresentationDisposition = 'RECOMMENDED' | 'LEAN' | 'PASS' | 'UNPRICED' | 'RESEARCH_ONLY';
export type NBASeasonPhase = 'REGULAR' | 'PLAY_IN' | 'POSTSEASON' | 'PRESEASON' | 'ALL_STAR' | 'UNKNOWN';

export interface AuthoritativeTierDecision {
  pickTier: PresentationTier;
  tierReason: string;
  tierScore: number;
  tierRequirementsPassed: string[];
  tierRequirementsFailed: string[];
}

export interface PresentationEvidence {
  id: string;
  category: string;
  source: string | null;
  detail: string;
  observedAt: string | null;
  stance: 'SUPPORTING' | 'COUNTER' | 'CONTEXT';
}

interface PresentationMarketBase {
  key: string;
  label: string;
  line: number | null;
}

export interface PlayerPropSubject {
  kind: 'PLAYER_PROP';
  gameId: string;
  player: { id: number | null; name: string; team: string | null };
  market: PresentationMarketBase & { side: 'over' | 'under' };
}

export type GameLineMarket = 'MONEYLINE' | 'SPREAD' | 'TOTAL' | 'TEAM_TOTAL';

export interface GameLineSubject {
  kind: 'GAME_LINE';
  gameId: string;
  home: { id: number | null; name: string };
  away: { id: number | null; name: string };
  market: PresentationMarketBase & {
    type: GameLineMarket;
    selection: 'HOME' | 'AWAY' | 'OVER' | 'UNDER';
    team: 'HOME' | 'AWAY' | null;
  };
}

export type PickPresentationSubject = PlayerPropSubject | GameLineSubject;

export interface PickPresentationInput {
  candidateId: string;
  subject: PickPresentationSubject;
  tierDecision?: AuthoritativeTierDecision | null;
  sportsbook?: string | null;
  americanOdds?: number | null;
  quoteStatus?: string | null;
  trueProbability?: number | null;
  modelProbability?: number | null;
  evPercent?: number | null;
  researchScore?: number | null;
  seasonPhase?: NBASeasonPhase | null;
  seasonPhaseCertainty?: 'VERIFIED' | 'UNCERTAIN' | 'MISSING' | null;
  seasonPhaseReason?: string | null;
  researchEvidence?: readonly PresentationEvidence[] | null;
  missing?: readonly string[];
}

export interface PresentedPick {
  candidateId: string;
  subject: PickPresentationSubject;
  tierDecision: AuthoritativeTierDecision | null;
  disposition: PresentationDisposition;
  pricing: {
    state: 'PRICED' | 'UNPRICED';
    sportsbook: string | null;
    americanOdds: number | null;
    quoteStatus: string | null;
  };
  metrics: {
    trueProbability: number | null;
    modelProbability: number | null;
    evPercent: number | null;
    researchScore: number | null;
    tierScore: number | null;
  };
  season: {
    phase: NBASeasonPhase | null;
    certainty: 'VERIFIED' | 'UNCERTAIN' | 'MISSING';
    reason: string | null;
  };
  researchEvidence: PresentationEvidence[];
  missing: string[];
}

export interface PickPresentationInputSet {
  picks: readonly PickPresentationInput[];
  requestedSort: PresentationSort;
  upstreamRankings?: Partial<Record<PresentationSort, readonly string[]>> | null;
  includePasses?: boolean;
}

export interface PickPresentation {
  schemaVersion: typeof PICK_PRESENTATION_SCHEMA_VERSION;
  outcome: 'PICKS_AVAILABLE' | 'NO_QUALIFIED_PICKS' | 'RESEARCH_ONLY';
  requestedSort: PresentationSort;
  sortStatus: 'UPSTREAM_ORDER' | 'SOURCE_ORDER';
  picks: PresentedPick[];
}