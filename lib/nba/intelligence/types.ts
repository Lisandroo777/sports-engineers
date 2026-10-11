import type { NBAResearchContext, NBAMarket } from '../context/types';

export type Verification = 'OFFICIAL' | 'ATTRIBUTED_REPORT' | 'CORROBORATED' | 'SPECULATION' | 'RUMOR' | 'UNVERIFIED' | 'CONFLICTED';
export type ClaimTopic = 'INJURY' | 'MISSING_SUBMISSION' | 'LINEUP' | 'STARTING_ROLE' | 'MINUTES_RESTRICTION' | 'ROTATION' | 'ROLE';
export type ClaimState = 'CURRENT' | 'STALE' | 'UNKNOWN' | 'CONFLICTED' | 'SUPERSEDED' | 'AFTER_CUTOFF';
export type LineupLevel = 'PROJECTED' | 'REPORTED' | 'OFFICIALLY_CONFIRMED' | 'UNKNOWN';

export interface IntelligenceSource {
  id: string;
  name: string;
  category: 'OFFICIAL_LEAGUE' | 'OFFICIAL_TEAM' | 'TEAM_EDITORIAL' | 'VERIFIED_REPORTER' | 'SECONDARY';
  origins: string[];
  pathPrefixes: string[];
  teamIds: number[];
  authors: Array<{ name: string; profileUrl: string; verifiedAt: string }>;
  access: { mode: 'MANUAL_ONLY' | 'PERMISSION_REQUIRED'; minIntervalMs: number; notes: string };
}

export interface ReportRevision {
  schemaVersion: '1';
  revisionId: string;
  documentId: string;
  sourceId: string;
  url: string;
  contentHash: string;
  mediaType: 'HTML' | 'PDF' | 'JSON' | 'REVIEWED_TEXT';
  title: string | null;
  author: string | null;
  publishedAt: string | null;
  updatedAt: string | null;
  firstSeenAt: string;
  fetchedAt: string;
  statementAt: string | null;
  text: string;
  originalUrls: string[];
  etag: string | null;
  lastModified: string | null;
  supersedesRevisionId: string | null;
  issues: string[];
}

export interface IdentityEntry {
  espnId: number;
  nbaId: number | null;
  name: string;
  aliases: string[];
  teamId: number;
  validFrom: string;
  validTo: string | null;
}

export interface TargetEvent {
  gameId: string;
  homeTeamId: number;
  awayTeamId: number;
  startsAt: string;
  basketballDate: string;
  matchupAliases: string[];
}

export interface IntelligenceClaim {
  id: string;
  documentRevisionId: string;
  sourceId: string;
  topic: ClaimTopic;
  playerIds: number[];
  teamId: number | null;
  gameId: string | null;
  appliesFrom: string | null;
  appliesUntil: string | null;
  statementAt: string | null;
  reportedAt: string | null;
  value: string;
  qualifier: 'EXPLICIT' | 'PROJECTED' | 'CONDITIONAL' | 'SPECULATIVE' | 'RUMOR';
  lineupLevel: LineupLevel | null;
  speaker: { name: string; role: 'COACH' | 'PLAYER' | 'REPORTER'; teamId: number; verifiedProfileUrl: string; verifiedAt: string; eventDate: string } | null;
  evidence: { excerpt: string; start: number; end: number; page: number | null; timecode: string | null };
  originalClaimId: string | null;
  originalUrls: string[];
  extraction: 'OFFICIAL_STRUCTURED' | 'REVIEWED';
  independence?: 'DIRECT' | 'CITED' | 'UNKNOWN';
  reviewedBy: string | null;
  reviewedAt: string | null;
  correctionOf: string | null;
}

export interface VerifiedClaim {
  claim: IntelligenceClaim;
  verification: Verification;
  state: ClaimState;
  reasons: string[];
  document: ReportRevision;
  independentSourceIds: string[];
  supersededBy: string | null;
}

export interface LineupIntelligence {
  teamId: number;
  level: LineupLevel;
  state: ClaimState;
  playerIds: number[];
  partialStarterIds: number[];
  supportingClaimIds: string[];
  unresolvedPlayerIds: number[];
  reasons: string[];
}

export interface IntelligenceChange {
  id: string;
  type: 'NEW' | 'VALUE_CHANGED' | 'VERIFICATION_CHANGED' | 'STALE' | 'CONFLICT' | 'CORRECTION';
  topic: ClaimTopic;
  teamId: number | null;
  playerIds: number[];
  previousClaimIds: string[];
  currentClaimIds: string[];
  detectedAt: string;
  eventAt: string | null;
  priority: 'CRITICAL' | 'IMPORTANT' | 'INFO';
  detail: string;
}

export interface IntelligenceEvidence {
  id: string;
  kind: 'FACT' | 'INFERENCE' | 'UNAVAILABLE';
  claimIds: string[];
  contextEvidenceIds: string[];
  markets: NBAMarket[];
  direction: 'SUPPORTING' | 'OPPOSING' | 'NEUTRAL' | 'UNKNOWN';
  detail: string;
  counterarguments: string[];
  reliability: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  correlationGroup: string;
}

export interface NBAIntelligenceSnapshot {
  schemaVersion: '1';
  sport: 'nba';
  snapshotId: string;
  target: TargetEvent;
  asOf: string;
  cutoff: string;
  claims: VerifiedClaim[];
  lineups: LineupIntelligence[];
  coaching: VerifiedClaim[];
  changes: IntelligenceChange[];
  evidence: IntelligenceEvidence[];
  affectedTeammates: Array<{ playerId: number; unavailableTeammateId: number; claimId: string; contextEvidenceIds: string[]; detail: string; counterarguments: string[] }>;
  marketViews: Record<NBAMarket, { evidenceIds: string[]; groupedEvidence: Record<string, string[]> }>;
  coverage: { sourceIds: string[]; missing: string[]; refreshMode: 'MANUAL'; lastAttemptAt: string | null; lastSuccessAt: string | null };
}

export interface IntelligenceInput {
  target: TargetEvent;
  asOf: string;
  documents: ReportRevision[];
  claims: IntelligenceClaim[];
  identities: IdentityEntry[];
  sources?: IntelligenceSource[];
  researchContexts?: readonly NBAResearchContext[];
  previous?: NBAIntelligenceSnapshot | null;
  missing?: string[];
  refresh?: { lastAttemptAt: string | null; lastSuccessAt: string | null };
}

export interface IntelligenceStore {
  putDocument(document: ReportRevision): Promise<void>;
  listDocuments(documentId?: string): Promise<ReportRevision[]>;
  putClaims(claims: IntelligenceClaim[]): Promise<void>;
  listClaims(): Promise<IntelligenceClaim[]>;
  putSnapshot(snapshot: NBAIntelligenceSnapshot): Promise<void>;
  latestSnapshot(gameId: string, before: string): Promise<NBAIntelligenceSnapshot | null>;
  reserveRefresh(key: string, at: string, minIntervalMs: number): Promise<boolean>;
  recordBackoff(key: string, retryAt: string): Promise<void>;
}