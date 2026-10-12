import { buildPickPresentation, type PickPresentationInput, type PresentationEvidence, type PresentationSort } from '../../presentation';
import { classifyPickTier } from '../../../ai/agent/pickTiers';
import type { ResearchSession, ResearchCandidateRecord } from '../../../ai/agent/session';
import { classifyGameRecommendation } from './recommendations';
import type { NBACandidate } from '../../../finder/nbaEngine';

function evidence(detail: string, index: number, category = 'RESEARCH', observedAt: string | null = null): PresentationEvidence {
  return { id: `${category}.${index}`, category, source: null, detail, observedAt, stance: category === 'RISK' ? 'COUNTER' : 'CONTEXT' };
}

function propInput(record: ResearchCandidateRecord): PickPresentationInput {
  const received = record.retrievedAt == null ? null : Date.parse(record.retrievedAt);
  const current = record.priceCurrent && ['FRESH', 'LIVE'].includes(record.priceFreshness)
    && (record.nbaPrediction?.quoteStatus == null || record.nbaPrediction.quoteStatus === 'CURRENT')
    && (received == null || Number.isFinite(received) && received <= Date.now() && Date.now() - received <= 3600000);
  const decision = classifyPickTier(current ? record : { ...record, priceCurrent: false, valueQualified: false }, 'nba');
  return { candidateId: record.candidateId, subject: { kind: 'PLAYER_PROP', gameId: record.gameId ?? '',
    player: { id: record.playerId, name: record.player, team: record.team },
    market: { key: record.marketKey, label: record.market, line: record.line, side: record.direction } }, tierDecision: decision,
    sportsbook: current ? record.book : null, americanOdds: current ? record.odds : null, quoteStatus: current ? 'CURRENT' : 'UNAVAILABLE',
    trueProbability: current ? record.trueProbability : null, modelProbability: current ? record.modelProbability : null,
    evPercent: current ? record.evPercent : null, researchScore: current ? record.researchScore : null,
    seasonPhase: record.nbaPrediction?.targetPhase ?? null,
    seasonPhaseCertainty: record.nbaPrediction?.targetPhase && record.nbaPrediction.targetPhase !== 'UNKNOWN' ? 'VERIFIED' : 'MISSING',
    researchEvidence: [...(record.nbaPrediction?.contextEvidence ?? []).map(entry => ({ id: entry.id, category: entry.metric,
      source: entry.sourceRefs[0]?.url ?? null, detail: entry.detail, observedAt: entry.sourceRefs[0]?.fetchedAt ?? null, stance: 'CONTEXT' as const })),
      ...record.howItLoses.map((reason, index) => evidence(reason, index, 'RISK'))],
    missing: record.rejectionReasons };
}

export function unclassifiedNBAPropResearch(candidates: NBACandidate[]): PickPresentationInput[] {
  return candidates.filter(candidate => candidate.playerMatch !== 'MATCHED' || !candidate.eliteAnalysis).map(candidate => {
    const current = candidate.priceTimestamp != null && Number.isFinite(Date.parse(candidate.priceTimestamp))
      && Date.parse(candidate.priceTimestamp) <= Date.now() && Date.now() - Date.parse(candidate.priceTimestamp) <= 3600000;
    return { candidateId: candidate.id, subject: { kind: 'PLAYER_PROP', gameId: candidate.gameId,
      player: { id: candidate.playerId, name: candidate.playerName, team: candidate.team },
      market: { key: candidate.market, label: candidate.marketLabel, line: candidate.line, side: candidate.side } },
      tierDecision: null, sportsbook: current ? candidate.book : null, americanOdds: current ? candidate.oddsAmerican : null,
      quoteStatus: current ? 'CURRENT' : 'UNAVAILABLE', trueProbability: null, modelProbability: null, evPercent: null, researchScore: null,
      seasonPhase: candidate.nbaPrediction?.targetPhase ?? null, seasonPhaseCertainty: 'MISSING',
      researchEvidence: [evidence(`Player matching: ${candidate.playerMatch}. No supported qualified model output.`, 0)],
      missing: ['Verified player/model evidence incomplete'] };
  });
}

export function buildNBAResearchPresentation(session: ResearchSession, query: string, recommendedIds: string[]) {
  const mode: PresentationSort = /best\s+value|highest\s+ev/i.test(query) ? 'BEST_VALUE'
    : /most\s+likely|safest|highest\s+probability/i.test(query) ? 'MOST_LIKELY' : 'BEST';
  const inputs: PickPresentationInput[] = session.candidates.map(propInput);
  inputs.push(...(session.nbaPresentationResearch ?? []).map(input => {
    const stamp = input.researchEvidence?.find(entry => entry.category === 'VERIFIED_QUOTE')?.observedAt;
    const stale = stamp != null && (!Number.isFinite(Date.parse(stamp)) || Date.parse(stamp) > Date.now() || Date.now() - Date.parse(stamp) > 3600000);
    return stale ? { ...input, americanOdds: null, sportsbook: null, quoteStatus: 'STALE', trueProbability: null,
      modelProbability: null, evPercent: null, researchScore: null } : input;
  }));
  for (const record of session.gameCandidates ?? []) {
    const decision = classifyGameRecommendation(record);
    const quote = record.quote;
    const current = Date.now() < Date.parse(quote.commenceTime) && Date.parse(quote.observedAt) <= Date.now()
      && Date.parse(quote.updatedAt) <= Date.parse(quote.observedAt) && Date.now() - Date.parse(quote.updatedAt) <= 3600000;
    inputs.push({ candidateId: record.candidateId, subject: { kind: 'GAME_LINE', gameId: record.gameId, home: record.home, away: record.away,
      market: { key: record.marketKey, label: record.marketKey, type: record.marketKey, line: record.line,
        selection: record.selection, team: record.selectedTeam } }, tierDecision: decision,
      sportsbook: current ? quote.sportsbook : null, americanOdds: current ? quote.americanOdds : null, quoteStatus: current ? 'CURRENT' : 'STALE',
      trueProbability: current ? record.trueProbability : null, modelProbability: current ? record.trueProbability : null,
      evPercent: current ? record.evPercent : null, researchScore: current ? record.researchScore : null,
      seasonPhase: record.projection.phase, seasonPhaseCertainty: record.availability?.phase.verified ? 'VERIFIED' : 'UNCERTAIN',
      researchEvidence: [...record.evidence.map((text, index) => evidence(text, index)), ...record.risks.map((text, index) => evidence(text, index, 'RISK'))],
      missing: decision.tierRequirementsFailed });
  }
  for (const game of session.modeledGames ?? []) {
    const represented = (session.gameCandidates ?? []).filter(record => record.gameId === game.gameId);
    const quotes = (game.quotes ?? []).filter(quote => !represented.some(record => JSON.stringify(record.quote) === JSON.stringify(quote)));
    for (const [index, quote] of quotes.entries()) {
      const current = Date.now() < Date.parse(quote.commenceTime) && Date.parse(quote.observedAt) <= Date.now()
        && Date.parse(quote.updatedAt) <= Date.parse(quote.observedAt) && Date.now() - Date.parse(quote.updatedAt) <= 3600000;
      inputs.push({ candidateId: `research.${game.gameId}.${index}.${quote.market}.${quote.sportsbookKey}`, subject: {
        kind: 'GAME_LINE', gameId: game.gameId, home: game.home, away: game.away,
        market: { key: quote.market, label: quote.market, type: quote.market, line: quote.line, selection: quote.selection, team: quote.team } },
        tierDecision: null, sportsbook: current ? quote.sportsbook : null, americanOdds: current ? quote.americanOdds : null,
        quoteStatus: current ? 'CURRENT' : 'STALE', trueProbability: null, modelProbability: null, evPercent: null, researchScore: null,
        seasonPhase: game.projection?.phase ?? game.availability?.phase.modelPhase ?? null,
        seasonPhaseCertainty: game.availability?.phase.verified ? 'VERIFIED' : 'MISSING',
        researchEvidence: [evidence(game.reason, 0), ...(game.availability?.blockers ?? []).map((reason, ordinal) => evidence(reason, ordinal, 'RISK'))],
        missing: ['Qualified model output unavailable'] });
    }
    if (!represented.length && !quotes.length) inputs.push({ candidateId: `research.${game.gameId}`, subject: {
      kind: 'GAME_LINE', gameId: game.gameId, home: game.home, away: game.away,
      market: { key: 'TOTAL', label: 'Team research (no priced selection)', type: 'TOTAL', line: null, selection: 'OVER', team: null } },
      tierDecision: null, americanOdds: null, sportsbook: null, trueProbability: null, modelProbability: null, evPercent: null,
      researchScore: null, seasonPhase: game.projection?.phase ?? null,
      seasonPhaseCertainty: game.availability?.phase.verified ? 'VERIFIED' : 'MISSING',
      researchEvidence: [evidence(game.reason, 0), ...(game.availability?.blockers ?? []).map((reason, index) => evidence(reason, index, 'RISK'))] });
  }
  const identity = (input: PickPresentationInput) => JSON.stringify([input.subject.kind,
    input.subject.kind === 'GAME_LINE' ? [input.subject.home.name, input.subject.away.name] : input.subject.player.name,
    input.subject.market, input.sportsbook, input.americanOdds]);
  const modeledQuotes = new Set(inputs.filter(input => !input.candidateId.startsWith('provider.')).map(identity));
  const uniqueInputs = inputs.filter(input => !input.candidateId.startsWith('provider.') || !modeledQuotes.has(identity(input)));
  const ordered = [...uniqueInputs].sort((first, second) => {
    const quality = (second.researchScore ?? -Infinity) - (first.researchScore ?? -Infinity);
    const probability = (second.trueProbability ?? -Infinity) - (first.trueProbability ?? -Infinity);
    const value = (second.evPercent ?? -Infinity) - (first.evPercent ?? -Infinity);
    return (mode === 'BEST_VALUE' ? value || quality || probability : mode === 'MOST_LIKELY' ? probability || quality || value : quality || probability || value)
      || first.candidateId.localeCompare(second.candidateId);
  });
  const presentation = buildPickPresentation({ picks: uniqueInputs, requestedSort: mode, includePasses: true,
    upstreamRankings: { [mode]: ordered.map(input => input.candidateId) } });
  const ids = new Set(recommendedIds);
  return { ...presentation, outcome: recommendedIds.length ? 'PICKS_AVAILABLE' as const
    : presentation.picks.some(pick => pick.disposition === 'RESEARCH_ONLY' || pick.pricing.state === 'UNPRICED') ? 'RESEARCH_ONLY' as const : 'NO_QUALIFIED_PICKS' as const,
    recommendedCandidateIds: recommendedIds,
    recommendations: presentation.picks.filter(pick => ids.has(pick.candidateId) && pick.tierDecision?.pickTier !== 'PASS'),
    researchedCandidates: presentation.picks.filter(pick => !ids.has(pick.candidateId)) };
}