import type { ResearchCandidateRecord, ResearchSession } from '../lib/ai/agent/session';
import { selectRankedCandidates } from '../lib/ai/agent/tools';
import { classifyPickTier } from '../lib/ai/agent/pickTiers';
import { evaluateNFLSavedResearchMode } from '../lib/nfl/researchMode';
import { nflNameMatches } from '../lib/ai/agent/nflRequestScope';
import { matchesNFLLowThreshold } from '../lib/nfl/researchIntent';
import { isNFLInjuryContextFresh } from '../lib/nfl/injuries';
import type { BettingConversation, BettingIntent } from './intent';

export function rankingQuery(intent: BettingIntent): string {
  return `${intent.researchMode === 'DEEP' ? 'Deep research ' : ''}${intent.rankingIntent === 'MOST_LIKELY' ? 'safest' : intent.rankingIntent === 'BEST_VALUE' ? 'best value' : 'best'} ${intent.sport ?? 'nfl'} props`;
}
export function searchQuery(intent: BettingIntent): string {
  return `${rankingQuery(intent)} ${intent.requestedCount} picks ${intent.markets[0] === 'player_reception_yds' ? 'receiving yards' : intent.markets[0] === 'player_receptions' ? 'receptions' : intent.markets[0]?.startsWith('player_pass_') ? 'passing props' : intent.markets[0]?.startsWith('player_rush_') ? 'rushing props' : ''} ${intent.teams.join(' vs ')} ${intent.players.length === 1 ? `for ${intent.players[0]}` : ''} ${intent.date ?? ''}`;
}
export interface IntentExecution {
  intent: BettingIntent;
  beforeFilters: number;
  afterFilters: number;
  results: ResearchCandidateRecord[];
  reply: string;
  conversation: BettingConversation;
  constraintsSatisfied: boolean;
  eliminatedBy: string[];
}
export function explainStoredCandidate(row: ResearchCandidateRecord, historicalOnly = false, question = ''): string {
  const evidence = row.nflResearchProfile?.evidence.for.map((item) => item.statement) ?? [];
  const risks = row.howItLoses?.length ? row.howItLoses : row.nflResearchProfile?.evidence.against.map((item) => item.statement) ?? [];
  const profile = row.nflResearchProfile;
  const answer = /recent|how has/i.test(question) ? `Recorded hit rates at this line: L5 ${row.l5Rate ?? 'unavailable'}%, L10 ${row.l10Rate ?? 'unavailable'}%. These are historical observations, not an independent probability guarantee.`
    : /role/i.test(question) ? profile?.role.value?.roleEvidence?.slice(0, 2).join('\n') || 'No supported role detail is recorded.'
      : /matchup/i.test(question) ? profile?.schemeMatchup.value?.evidenceSummary || 'No supported matchup detail is recorded.'
        : /injury/i.test(question) ? profile?.injuryNetwork.value?.map((entry) => `${entry.player}: ${entry.status}. ${entry.opportunityImpact ?? 'Impact not quantified.'}`).slice(0, 3).join('\n') || 'No additional current injury claim is supported by the stored profile.'
          : /makes.*(?:elite|nuke|sharp)|tier/i.test(question) ? classifyPickTier(row, 'nfl').tierReason
            : /risk|lose/i.test(question) ? risks[0] ?? 'No additional sourced risk detail is available.' : evidence.slice(0, 2).join('\n');
  return `${row.player} ${row.direction.toUpperCase()} ${row.line} — ${row.market}.${historicalOnly ? ' This is stored research, not a current verified recommendation.' : ''}\n${answer}\nMain risk: ${risks[0] ?? 'No additional sourced risk detail is available.'}`;
}
function teamMatches(name: string | null, requested: string) {
  return name?.toLowerCase() === requested.toLowerCase() || name?.toLowerCase().includes(requested.toLowerCase());
}
export function executeBettingIntent(session: ResearchSession, intent: BettingIntent, previous?: BettingConversation | null, question = ''): IntentExecution {
  const stages: Array<[string, (row: ResearchCandidateRecord) => boolean]> = [
    ['sport/date', () => (!intent.sport || session.sport === intent.sport) && (!intent.date || intent.date === session.date)],
    ['player', (row) => !intent.players.length || intent.players.some((player) => nflNameMatches(player, row.player))],
    ['game', (row) => (!intent.games.length || Boolean(row.gameId && intent.games.includes(row.gameId))) && intent.teams.every((team) => teamMatches(row.team, team) || teamMatches(row.opponent, team))],
    ['market', (row) => !intent.markets.length || intent.markets.includes(row.marketKey)],
    ['position', (row) => !intent.position || (row.nflResearchProfile?.role.value?.position ?? row.position)?.toUpperCase() === intent.position],
    ['direction', (row) => !intent.directions.length || intent.directions.includes(row.direction)],
    ['odds', (row) => row.odds != null && (intent.oddsConstraints.min == null || row.odds >= intent.oddsConstraints.min) && (intent.oddsConstraints.max == null || row.odds <= intent.oddsConstraints.max)],
    ['line preference', (row) => !intent.linePreference || matchesNFLLowThreshold(row)],
    ['reference', (row) => !intent.referenceIds.length || intent.referenceIds.includes(row.candidateId)],
    ['pregame', (row) => {
      const ledger = session.toolMeta?.nflLedger?.games;
      const game = ledger?.find((game) => game.gameId === row.gameId);
      if (!game) return !ledger?.length;
      return game.eligibility === 'PREGAME' && Boolean(game.kickoff) && Date.parse(game.kickoff) > Date.now();
    }],
    ['current price', (row) => {
      const published = row.nflResearchProfile?.market?.provenance?.[0]?.publishedAt;
      if (!published) return row.priceCurrent;
      const age = Date.now() - Date.parse(published);
      return row.priceCurrent && Number.isFinite(age) && age >= 0 && age <= 3600000;
    }],
    ['current injury evidence', (row) => session.sport !== 'nfl' || isNFLInjuryContextFresh(row.injuryContext as Parameters<typeof isNFLInjuryContextFresh>[0])],
  ];
  let pool = session.candidates;
  const eliminatedBy: string[] = [];
  for (const [name, filter] of stages) {
    const before = pool.length;
    pool = pool.filter(filter);
    if (before && !pool.length) eliminatedBy.push(name);
  }
  if (intent.unsupportedMarket || ['OUT_OF_SCOPE', 'CLARIFY', 'EDUCATION'].includes(intent.action)) pool = [];
  if (intent.researchMode === 'DEEP') pool = pool.filter((row) => row.nflResearchProfile?.researchMode !== 'STANDARD');
  pool = pool.map((row) => evaluateNFLSavedResearchMode(row, intent.researchMode)).filter((row) => {
    const decision = classifyPickTier(row, session.sport);
    return !intent.requestedTiers.length || intent.requestedTiers.includes(decision.pickTier);
  });
  const uncappedSport = session.sport === 'nfl' || session.sport === 'nba';
  const count = intent.comparisonIntent ? 2 : uncappedSport && !intent.countRequested && !intent.combinationIntent && !intent.referenceIds.length
    ? pool.length : intent.requestedCount;
  const ranked = selectRankedCandidates(pool, rankingQuery(intent), { sport: session.sport, maxResults: uncappedSport ? pool.length : 15 });
  let results = ranked.selected;
  if (intent.comparisonIntent && intent.players.length >= 2) {
    const seenPlayers = new Set<string>();
    results = results.filter((row) => {
      if (seenPlayers.has(row.player)) return false;
      seenPlayers.add(row.player);
      return true;
    });
  }
  if (intent.combinationIntent) {
    const accepted: ResearchCandidateRecord[] = [];
    for (const row of results) {
      if (accepted.some((other) => other.playerId != null && other.playerId === row.playerId || other.player === row.player
        || (row.correlationGroups ?? []).some((group) => (other.correlationGroups ?? []).some((peer) => peer.id === group.id)))) continue;
      accepted.push(row);
    }
    results = accepted;
  }
  results = results.slice(0, count);
  const constraintsSatisfied = results.every((row) => stages.every(([, predicate]) => predicate(row))
    && (!intent.requestedTiers.length || intent.requestedTiers.includes(classifyPickTier(row, session.sport).pickTier))) && results.length <= count;
  const conversation: BettingConversation = { intent, displayedIds: intent.referenceIds.length && previous?.displayedIds.length ? previous.displayedIds : results.map((row) => row.candidateId), referencedIds: intent.referenceIds };
  let reply: string;
  if (intent.action === 'OUT_OF_SCOPE') reply = 'DeepSide AI is designed for sports-betting research. Ask me about picks, odds, markets, or a bet you are considering.';
  else if (intent.action === 'CLARIFY') reply = intent.clarification ?? 'Which play do you mean?';
  else if (intent.unsupportedMarket) reply = `I can discuss ${intent.unsupportedMarket}, but the connected NFL recommendation engine currently researches player props. I cannot provide a verified pick for that market.`;
  else if (!results.length) reply = `No ${intent.requestedTiers.length ? `${intent.requestedTiers.join(' or ')} ` : ''}${intent.markets.length ? `${intent.markets.map((market) => market.replace('player_', '').replaceAll('_', ' ')).join(' / ')} ` : ''}${intent.directions[0] ? `${intent.directions[0].toUpperCase()} ` : ''}plays currently qualify${intent.players.length ? ` for ${intent.players.join(' or ')}` : ''}.${eliminatedBy.length ? ` The ${eliminatedBy[0]} constraint left no eligible candidates.` : ' None passed the publication requirements and requested quality floor.'}`;
  else if (intent.explanationIntent) {
    const row = results[0];
    reply = explainStoredCandidate(row, false, question);
  } else if (intent.comparisonIntent) {
    const first = results[0];
    reply = `${first.player} ${first.direction.toUpperCase()} ${first.line} is ${intent.rankingIntent === 'MOST_LIKELY' ? 'the most likely of these to hit' : intent.rankingIntent === 'BEST_VALUE' ? 'the stronger value of these' : 'my balanced preference of these'}.`;
    reply += `\n${results.map((row) => `${row.player}: recorded probability ${row.trueProbability ?? 'unavailable'}%, EV ${row.evPercent ?? 'unavailable'}%, edge ${row.priceEdgePercent ?? 'unavailable'} pp.`).join('\n')}`;
    if (results.length < 2) reply += ' Only one of the requested plays currently qualifies.';
  } else {
    reply = `${intent.combinationIntent ? `${results.length}-LEG SLIP` : intent.rankingIntent === 'MOST_LIKELY' ? `MOST LIKELY ${session.sport.toUpperCase()} PLAYS` : intent.rankingIntent === 'BEST_VALUE' ? `BEST VALUE ${session.sport.toUpperCase()} PLAYS` : `BEST ${session.sport.toUpperCase()} PLAYS`}${results.length < count ? `\nOnly ${results.length} met your criteria${intent.combinationIntent ? ' without reusing a player' : ''}.` : ''}`;
    if (intent.combinationIntent) reply += '\nEach leg qualifies individually. Same-game legs may be correlated; no combined probability or payout is claimed.';
    if (!uncappedSport && intent.requestedCount === 15 && results.length === 15) reply += '\nShowing up to 15 qualifying plays.';
  }
  return { intent, beforeFilters: session.candidates.length, afterFilters: pool.length, results, reply, conversation, constraintsSatisfied, eliminatedBy };
}