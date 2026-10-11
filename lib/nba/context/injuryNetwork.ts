import { resolveAvailability } from './availability';
import { addEvidence, describe, sample, sources } from './evidence';
import { teamPlayer } from './rotation';
import type { BuildEnvironment, ContextGame, ContextStats, InjuryNetworkContext, InjuryNetworkEdge, NBAMarket } from './types';

const METRICS: Array<{ key: keyof ContextStats; markets: NBAMarket[] }> = [
  { key: 'minutes', markets: ['minutes', 'points', 'rebounds', 'assists', '3pm'] },
  { key: 'fga', markets: ['points'] }, { key: 'fta', markets: ['points'] }, { key: 'tpa', markets: ['3pm', 'points'] },
  { key: 'assists', markets: ['assists'] }, { key: 'rebounds', markets: ['rebounds'] },
];

export function buildInjuryNetwork(env: BuildEnvironment): InjuryNetworkContext {
  const { playerId, teamId } = env.request;
  const teammateIds = [...new Set(env.snapshot.injuries.filter(report => report.teamId === teamId && report.playerId != null && report.playerId !== playerId).map(report => report.playerId!))].sort((first, second) => first - second);
  const edges: InjuryNetworkEdge[] = [];
  const evidenceIds: string[] = [];
  const latestRole = [...env.teamGames].reverse().map(game => teamPlayer(game, teamId, playerId)).find(player => player?.didNotPlay === false && player.starter != null)?.starter;
  for (const teammateId of teammateIds) {
    const availability = resolveAvailability(env, teammateId, teamId);
    const withGames: ContextGame[] = [];
    const withoutGames: ContextGame[] = [];
    const excluded: string[] = [];
    const otherAbsences = new Map<string, string>();
    const rosterPatterns = new Map<string, string>();
    for (const game of env.teamGames) {
      const team = game.teams.find(team => team.teamId === teamId);
      const player = teamPlayer(game, teamId, playerId);
      const teammate = teamPlayer(game, teamId, teammateId);
      if (!team?.rosterComplete || !player || player.didNotPlay !== false || player.stats.minutes == null || player.stats.minutes <= 0
        || latestRole == null || player.starter !== latestRole || !teammate || teammate.didNotPlay == null) {
        excluded.push(`${game.gameId}: incomplete participation or different/unknown candidate start role`);
        continue;
      }
      otherAbsences.set(game.gameId, team.players.filter(member => member.playerId !== playerId && member.playerId !== teammateId && member.didNotPlay === true).map(member => member.playerId).sort().join(':'));
      rosterPatterns.set(game.gameId, team.players.map(member => member.playerId).sort((first, second) => first - second).join(':'));
      if (teammate.didNotPlay === true) withoutGames.push(game);
      else if (teammate.stats.minutes != null && teammate.stats.minutes > 0) withGames.push(game);
      else excluded.push(`${game.gameId}: teammate participation unresolved`);
    }
    const signature = (game: ContextGame) => `${rosterPatterns.get(game.gameId)}|${otherAbsences.get(game.gameId)}`;
    const signatures = new Set(withGames.map(signature));
    const comparableWithout = withoutGames.filter(game => signatures.has(signature(game)));
    const withoutSignatures = new Set(comparableWithout.map(signature));
    const comparableWith = withGames.filter(game => withoutSignatures.has(signature(game)));
    for (const game of [...withGames, ...withoutGames]) if (![...comparableWith, ...comparableWithout].includes(game)) excluded.push(`${game.gameId}: unmatched other-DNP pattern or roster membership`);
    const confounders = ['Teammate nonparticipation is observed; injury cause is not assumed.', 'Opponent strength, game script and unobserved lineup overlap are not causally controlled.', 'Matching other-DNP patterns does not establish an identical rotation or roster.'];
    const edge: InjuryNetworkEdge = { teammateId, currentStatus: availability.status, state: availability.state === 'AVAILABLE' && comparableWith.length && comparableWithout.length ? 'PARTIAL' : 'UNKNOWN', evidenceIds: [],
      cohorts: { with: comparableWith.map(game => game.gameId), without: comparableWithout.map(game => game.gameId), excluded },
      matchedOtherDnpPatterns: [...new Set(comparableWithout.map(game => otherAbsences.get(game.gameId) || 'none'))], confounders };
    const statusId = addEvidence(env, { id: `injuryNetwork.${teammateId}.status`, metric: 'teammateReportedAvailability', kind: availability.reports.length ? 'FACT' : 'UNAVAILABLE', state: availability.state,
      value: availability.reports.length ? availability.status : null, detail: `Teammate ${teammateId}: ${availability.status}. Questionable/probable status is not an assumed absence.`,
      sourceRefs: availability.reports.map(report => report.source), correlationGroup: `teammate.${teammateId}` });
    edge.evidenceIds.push(statusId);
    for (const metric of METRICS) {
      const values = (games: ContextGame[]) => games.flatMap(game => {
        const value = teamPlayer(game, teamId, playerId)!.stats[metric.key];
        return value != null && Number.isFinite(value) ? [value] : [];
      });
      const withValues = values(comparableWith);
      const withoutValues = values(comparableWithout);
      const withSummary = describe(withValues);
      const withoutSummary = describe(withoutValues);
      const id = addEvidence(env, { id: `injuryNetwork.${teammateId}.${metric.key}`, metric: `teammateConditioned.${metric.key}`, markets: metric.markets,
        value: withSummary.mean != null && withoutSummary.mean != null ? { with: withSummary, without: withoutSummary, difference: withoutSummary.mean - withSummary.mean } : null,
        units: metric.key === 'minutes' ? 'minutes' : 'per game', state: 'PARTIAL', reliability: 'LOW',
        detail: `Observed ${metric.key} with teammate ${teammateId} participating versus explicit DNP, same candidate start role and matched other-DNP patterns. Association, not automatic redistribution.`,
        sourceRefs: sources([...comparableWith, ...comparableWithout]), sample: sample(env, [...comparableWith, ...comparableWithout], Math.min(withValues.length, withoutValues.length), ['same candidate starter flag', 'same covered roster membership', `matched other explicit DNP patterns: ${edge.matchedOtherDnpPatterns.join(', ')}`], excluded),
        reliabilityReasons: confounders, missingReasons: withValues.length && withoutValues.length ? [] : ['Both measured cohorts are required.'],
        dependencyIds: [statusId, 'rotation.starts'], correlationGroup: metric.key === 'minutes' ? 'minutes.role' : `opportunity.${metric.key}` });
      edge.evidenceIds.push(id);
      if (availability.state === 'AVAILABLE' && ['OUT', 'DOUBTFUL', 'QUESTIONABLE'].includes(availability.status) && withValues.length >= 5 && withoutValues.length >= 5 && withSummary.mean !== withoutSummary.mean) {
        const difference = withoutSummary.mean! - withSummary.mean!;
        edge.evidenceIds.push(addEvidence(env, { id: `injuryNetwork.${teammateId}.${metric.key}.scenario`, metric: `conditionalOpportunity.${metric.key}`, kind: 'INFERENCE', state: 'PARTIAL', value: { condition: `IF teammate ${teammateId} does not participate`, observedDifference: difference },
          direction: difference > 0 ? 'HELPS' : 'HURTS', directionBasis: 'Direction describes observed opportunity in a conditional absence scenario, not over/under value or a projected change.',
          markets: metric.markets, detail: 'Comparable historical cohorts suggest a possible opportunity change IF this teammate is absent. Not a causal estimate, guarantee or probability-weighted adjustment.',
          reliability: 'LOW', reliabilityReasons: confounders, sourceRefs: sources([...comparableWith, ...comparableWithout]), sample: sample(env, [...comparableWith, ...comparableWithout], Math.min(withValues.length, withoutValues.length)),
          dependencyIds: [id, statusId], correlationGroup: metric.key === 'minutes' ? 'minutes.role' : `opportunity.${metric.key}` }));
      }
    }
    evidenceIds.push(...edge.evidenceIds);
    edges.push(edge);
  }
  if (!edges.length) evidenceIds.push(addEvidence(env, { id: 'injuryNetwork.coverage', metric: 'teammateAbsenceNetwork', state: 'UNKNOWN', detail: 'No usable teammate reports or linked participation cohorts. No position-based opportunity assumptions are made.', correlationGroup: 'availability.team' }));
  return { edges, evidenceIds };
}