import { espnSiteFetch } from './client';
import { normalizedNFLInput, withNFLResearchSnapshot } from './researchSnapshot';
import type { NFLGameLogEntry } from './types';
import type { NFLKickingFact, NFLKickingOpportunityInput } from './kickingResearch';

interface RawStat { name?: string; label?: string; displayValue?: string; value?: unknown }
interface RawTeam { team?: { id?: string }; statistics?: RawStat[] }
interface RawDrive {
  id?: string;
  team?: string;
  result?: string;
  end?: unknown;
}
export interface NFLKickingOpportunitySummary {
  header?: { id?: string; competitions?: Array<{ date?: string; status?: { type?: { completed?: boolean } } }> };
  boxscore?: { teams?: RawTeam[] };
  drives?: { previous?: RawDrive[] };
}

export interface NFLKickingOpportunityEvidence {
  field: string;
  status: 'AVAILABLE' | 'PARTIAL' | 'UNAVAILABLE';
  sourceURL: string | null;
  rawCount?: number;
  retrievedAt: string;
  sampleId: string;
  gameIds: string[];
  reason: string | null;
}

export interface NFLKickingOpportunityRate {
  numerator: NFLKickingFact;
  denominator: NFLKickingFact;
  rate: number | null;
}

export interface NFLKickingOpportunityFact extends NFLKickingFact {
  sourceURL: string;
  sourceURLs: string[];
}

type SourcedOpportunityFacts = { [Key in keyof NFLKickingOpportunityInput]?: NFLKickingOpportunityFact };

export interface NFLKickingOpportunityResult {
  facts: SourcedOpportunityFacts;
  evidence: NFLKickingOpportunityEvidence[];
  missingFields: string[];
  gameIds: string[];
  sourceURLs: string[];
  fourthDownConversions?: NFLKickingOpportunityRate;
  offensiveScoringEfficiency?: NFLKickingOpportunityRate;
}

interface ParseOptions {
  mode?: 'offense' | 'defense';
  retrievedAt?: string;
  sampleId?: string;
}

const baseURL = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const factKeys = ['teamDrives', 'teamRedZoneTrips', 'teamRedZoneTouchdowns', 'opponentRedZoneTrips',
  'opponentRedZoneTouchdowns', 'fourthDownAttempts', 'fourthDownOpportunities', 'expectedDrives', 'teamTotal'] as const;
const unsupported: Partial<Record<keyof NFLKickingOpportunityInput, string>> = {
  fourthDownOpportunities: 'Complete fourth-down scrimmage decision coverage and play identity are not established; conversion attempts are not decision opportunities.',
  expectedDrives: 'Historical counts do not establish projected drives.',
  teamTotal: 'No sourced team total supplied.',
};

function count(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function pair(value: string | undefined): [number, number] | null {
  const match = value?.match(/^\s*(\d+)\s*[-/]\s*(\d+)\s*$/);
  if (!match) return null;
  const made = count(match[1]);
  const attempted = count(match[2]);
  return made !== null && attempted !== null && made <= attempted ? [made, attempted] : null;
}

function rate(numerator: NFLKickingFact, denominator: NFLKickingFact): NFLKickingOpportunityRate {
  return { numerator, denominator, rate: denominator.value > 0 ? numerator.value / denominator.value : null };
}

export function parseNFLKickingOpportunity(
  summary: NFLKickingOpportunitySummary,
  offenseTeamId: number,
  opponentTeamId?: number,
  options: ParseOptions = {},
): NFLKickingOpportunityResult {
  const mode = options.mode ?? 'offense';
  const target = mode === 'defense' ? opponentTeamId ?? offenseTeamId : offenseTeamId;
  const teams = summary.boxscore?.teams ?? [];
  const uniqueTeams = teams.length === 2 && teams.every((entry) => /^\d+$/.test(entry.team?.id ?? ''))
    && teams[0].team?.id !== teams[1].team?.id;
  const selected = uniqueTeams && teams.some((entry) => Number(entry.team?.id) === target)
    ? teams.find((entry) => mode === 'defense' ? Number(entry.team?.id) !== target : Number(entry.team?.id) === target) : undefined;
  const gameId = summary.header?.id;
  const sourceURL = gameId ? `${baseURL}/summary?event=${encodeURIComponent(gameId)}` : null;
  const retrievedAt = options.retrievedAt ?? new Date().toISOString();
  const sampleId = options.sampleId ?? `espn-kicking:${mode}:${target}:${gameId ?? 'unknown'}`;
  const facts: SourcedOpportunityFacts = {};
  const evidence: NFLKickingOpportunityEvidence[] = [];
  const gameIds = gameId ? [gameId] : [];
  const fact = (value: number): NFLKickingOpportunityFact => ({ value, source: sourceURL!, sourceURL: sourceURL!,
    sourceURLs: [sourceURL!], retrievedAt, sampleId });
  const stats = new Map((selected?.statistics ?? []).map((stat) => [stat.name, stat]));
  const drivesStat = stats.get('totalDrives');
  const drives = count(drivesStat?.displayValue) ?? count(drivesStat?.value);
  const redZone = pair(stats.get('redZoneAttempts')?.displayValue);
  const fourthDown = pair(stats.get('fourthDownEff')?.displayValue);
  const usable = Boolean(selected && sourceURL && Number.isFinite(Date.parse(retrievedAt)));
  if (usable) {
    if (mode === 'offense') {
      if (drives !== null) facts.teamDrives = fact(drives);
      if (redZone) {
        facts.teamRedZoneTouchdowns = fact(redZone[0]);
        facts.teamRedZoneTrips = fact(redZone[1]);
      }
      if (fourthDown) facts.fourthDownAttempts = fact(fourthDown[1]);
    } else if (redZone) {
      facts.opponentRedZoneTouchdowns = fact(redZone[0]);
      facts.opponentRedZoneTrips = fact(redZone[1]);
    }
  }
  const relevant = mode === 'defense' ? ['opponentRedZoneTrips', 'opponentRedZoneTouchdowns'] as const
    : ['teamDrives', 'teamRedZoneTrips', 'teamRedZoneTouchdowns', 'fourthDownAttempts', 'fourthDownOpportunities', 'expectedDrives', 'teamTotal'] as const;
  for (const field of relevant) {
    const available = facts[field] != null;
    evidence.push({ field, status: available ? 'AVAILABLE' : 'UNAVAILABLE', sourceURL, retrievedAt, sampleId, gameIds,
      ...(available ? { rawCount: facts[field]!.value } : {}),
      reason: available ? null : unsupported[field] ?? (!selected ? 'Unambiguous team identity unavailable.' : 'Exact named ESPN count or valid displayValue pair unavailable; missing is not zero.') });
  }
  const result: NFLKickingOpportunityResult = { facts, evidence,
    missingFields: evidence.filter((entry) => entry.status === 'UNAVAILABLE').map((entry) => entry.field),
    gameIds, sourceURLs: sourceURL ? [sourceURL] : [] };
  if (usable && mode === 'offense' && fourthDown) {
    result.fourthDownConversions = rate(fact(fourthDown[0]), fact(fourthDown[1]));
  }
  const previous = summary.drives?.previous ?? [];
  const teamDrives = previous.filter((drive) => drive.team === selected?.team?.id);
  const recognized = new Set(['TD', 'FG', 'PUNT', 'INT', 'FUMBLE', 'DOWNS', 'MISSED FG', 'SF', 'END OF HALF', 'END OF GAME']);
  if (usable && mode === 'offense' && drives !== null && drives > 0 && teamDrives.length === drives
    && previous.every((drive) => teams.some((team) => team.team?.id === drive.team))
    && new Set(teamDrives.map((drive) => drive.id)).size === drives
    && teamDrives.every((drive) => drive.id && drive.end && recognized.has(drive.result ?? ''))) {
    result.offensiveScoringEfficiency = rate(fact(teamDrives.filter((drive) => drive.result === 'TD' || drive.result === 'FG').length), fact(drives));
  }
  evidence.push({ field: 'offensiveScoringEfficiency', status: result.offensiveScoringEfficiency ? 'AVAILABLE' : 'UNAVAILABLE',
    sourceURL, retrievedAt, sampleId, gameIds, reason: result.offensiveScoringEfficiency ? null : 'Complete identified drives with recognized final results and exact totalDrives coverage required.' });
  if (!result.offensiveScoringEfficiency) result.missingFields.push('offensiveScoringEfficiency');
  return result;
}

interface ScheduledEvent {
  id: string;
  date: string;
  season?: { year?: number };
  competitions?: Array<{ competitors?: Array<{ team?: { id?: string } }>; status?: { type?: { completed?: boolean } } }>;
}
interface OpportunityInput {
  teamId: number;
  opponentTeamId: number;
  season: number;
  before: string;
  currentLogs?: readonly NFLGameLogEntry[];
}

export async function getNFLKickingOpportunity(input: OpportunityInput): Promise<NFLKickingOpportunityResult> {
  const cutoff = Date.parse(input.before);
  if (!Number.isFinite(cutoff) || !Number.isInteger(input.season)
    || ![input.teamId, input.opponentTeamId].every((id) => Number.isSafeInteger(id) && id > 0)
    || input.teamId === input.opponentTeamId) throw new Error('Valid distinct team IDs, season, and before kickoff are required.');
  return withNFLResearchSnapshot(async () => {
    const retrievedAt = new Date().toISOString();
    const evidence: NFLKickingOpportunityEvidence[] = [];
    const sourceURLs = new Set<string>();
    const gameIds = new Set<string>();
    const note = (field: string, sourceURL: string | null, reason: string) => evidence.push({ field,
      status: 'UNAVAILABLE', sourceURL, retrievedAt, sampleId: `espn-kicking:${input.season}:${input.before}`, gameIds: [], reason });
    const eventsFor = async (teamId: number, mode: 'offense' | 'defense'): Promise<ScheduledEvent[]> => {
      if (mode === 'offense' && input.currentLogs !== undefined) {
        return [...new Map(input.currentLogs.filter((log) => log.result != null && log.season === input.season
          && (log.teamId == null || log.teamId === teamId) && /^\d+$/.test(log.gameId) && Date.parse(log.date) < cutoff)
          .map((log) => [log.gameId, { id: log.gameId, date: log.date }])).values()]
          .sort((left, right) => Date.parse(right.date) - Date.parse(left.date)).slice(0, 5);
      }
      const sourceURL = `${baseURL}/teams/${teamId}/schedule?season=${input.season}`;
      sourceURLs.add(sourceURL);
      try {
        const schedule = await normalizedNFLInput(`kicking-schedule:v1:${teamId}:${input.season}`, 15 * 60000,
          () => espnSiteFetch<{ events?: ScheduledEvent[] }>(`teams/${teamId}/schedule`, { season: String(input.season) }, 300));
        if (!Array.isArray(schedule.events)) throw new Error('Schedule events unavailable');
        return [...new Map(schedule.events.filter((event) => /^\d+$/.test(event.id)
          && Date.parse(event.date) < cutoff && (event.season?.year == null || event.season.year === input.season)
          && event.competitions?.[0]?.status?.type?.completed === true
          && event.competitions[0].competitors?.some((entry) => Number(entry.team?.id) === teamId))
          .map((event) => [event.id, event])).values()]
          .sort((left, right) => Date.parse(right.date) - Date.parse(left.date)).slice(0, 5);
      } catch {
        note(`${mode}.schedule`, sourceURL, 'ESPN recent schedule unavailable; no games inferred.');
        return [];
      }
    };
    const [teamEvents, opponentEvents] = await Promise.all([eventsFor(input.teamId, 'offense'), eventsFor(input.opponentTeamId, 'defense')]);
    const load = async (events: ScheduledEvent[], mode: 'offense' | 'defense') => Promise.all(events.map(async (event) => {
      const sourceURL = `${baseURL}/summary?event=${event.id}`;
      sourceURLs.add(sourceURL);
      gameIds.add(event.id);
      try {
        const cached = await normalizedNFLInput(`kicking-summary:v1:${event.id}`, 15 * 60000, async () => ({
          summary: await espnSiteFetch<NFLKickingOpportunitySummary>('summary', { event: event.id }, 300),
          retrievedAt: new Date().toISOString(),
        }));
        const competition = cached.summary.header?.competitions?.[0];
        if (cached.summary.header?.id && cached.summary.header.id !== event.id) throw new Error('Summary event mismatch');
        if (competition && (competition.status?.type?.completed !== true || !competition.date || !(Date.parse(competition.date) < cutoff))) {
          throw new Error('Summary not completed before kickoff');
        }
        const parsed = parseNFLKickingOpportunity({ ...cached.summary, header: { ...cached.summary.header, id: event.id } }, input.teamId,
          input.opponentTeamId, { mode, retrievedAt: cached.retrievedAt });
        evidence.push(...parsed.evidence.map((entry) => ({ ...entry, field: `${mode}.game.${event.id}.${entry.field}` })));
        return parsed;
      } catch {
        note(`${mode}.summary.${event.id}`, sourceURL, 'ESPN summary unavailable or historical event identity/completion check failed.');
        return null;
      }
    }));
    const [teamResults, opponentResults] = await Promise.all([load(teamEvents, 'offense'), load(opponentEvents, 'defense')]);
    const facts: SourcedOpportunityFacts = {};
    const aggregate = (results: Array<NFLKickingOpportunityResult | null>, keys: readonly (keyof NFLKickingOpportunityInput)[], mode: string) => {
      const valid = results.filter((result): result is NFLKickingOpportunityResult => result !== null);
      const sampleId = `espn-kicking:${mode}:${mode === 'offense' ? input.teamId : input.opponentTeamId}:${valid.flatMap((result) => result.gameIds).sort().join(',')}`;
      const sampleURLs = valid.flatMap((result) => result.sourceURLs).sort();
      const source = sampleURLs.join(' ');
      const sampleRetrievedAt = valid.map((result) => result.evidence[0]?.retrievedAt).filter(Boolean).sort()[0] ?? retrievedAt;
      for (const key of keys) {
        const values = valid.map((result) => result.facts[key]);
        const complete = values.length > 0 && values.every((value) => value != null);
        if (complete) facts[key] = { value: values.reduce((sum, value) => sum + value!.value, 0), source,
          sourceURL: sampleURLs[0], sourceURLs: sampleURLs, retrievedAt: sampleRetrievedAt, sampleId };
        const status = complete ? valid.length === results.length ? 'AVAILABLE' : 'PARTIAL' : 'UNAVAILABLE';
        evidence.push({ field: key, status, sourceURL: source || null, retrievedAt: sampleRetrievedAt, sampleId,
          gameIds: valid.flatMap((result) => result.gameIds), reason: status === 'AVAILABLE' ? null
            : complete ? `${valid.length}/${results.length} selected game summaries available; totals cover only those games.`
              : unsupported[key] ?? 'Exact counts missing from one or more selected summaries; aggregate withheld to preserve matching samples.' });
      }
      return valid;
    };
    const teamValid = aggregate(teamResults, ['teamDrives', 'teamRedZoneTrips', 'teamRedZoneTouchdowns', 'fourthDownAttempts',
      'fourthDownOpportunities', 'expectedDrives', 'teamTotal'], 'offense');
    aggregate(opponentResults, ['opponentRedZoneTrips', 'opponentRedZoneTouchdowns'], 'defense');
    const result: NFLKickingOpportunityResult = { facts, evidence, missingFields: [], gameIds: [...gameIds].sort(), sourceURLs: [...sourceURLs].sort() };
    for (const field of ['fourthDownConversions', 'offensiveScoringEfficiency'] as const) {
      const values = teamValid.map((entry) => entry[field]);
      if (values.length && values.every((value) => value != null)) {
        const identity = facts.teamDrives ?? facts.fourthDownAttempts;
        if (identity) result[field] = rate({ ...identity, value: values.reduce((sum, value) => sum + value!.numerator.value, 0) },
          { ...identity, value: values.reduce((sum, value) => sum + value!.denominator.value, 0) });
      }
      evidence.push({ field, status: result[field] ? teamValid.length === teamResults.length ? 'AVAILABLE' : 'PARTIAL' : 'UNAVAILABLE',
        sourceURL: result[field]?.numerator.source ?? null, retrievedAt: result[field]?.numerator.retrievedAt ?? retrievedAt,
        sampleId: result[field]?.numerator.sampleId ?? '', gameIds: teamValid.flatMap((entry) => entry.gameIds),
        reason: result[field] ? null : 'Complete compatible observed counts unavailable; no inferred efficiency.' });
    }
    result.missingFields = [...new Set([...factKeys.filter((key) => facts[key] == null),
      ...evidence.filter((entry) => entry.status !== 'AVAILABLE').map((entry) => entry.field)])];
    return result;
  });
}