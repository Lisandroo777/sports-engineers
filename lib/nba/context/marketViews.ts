import { addEvidence, describe, mean, sample, sources, ALL_MARKETS } from './evidence';
import { teamPlayer } from './rotation';
import type { BuildEnvironment, ContextStats, NBAMarket, NBAResearchContext } from './types';

const COMPONENTS: Partial<Record<NBAMarket, NBAMarket[]>> = { pra: ['points', 'rebounds', 'assists'], pr: ['points', 'rebounds'], pa: ['points', 'assists'], ra: ['rebounds', 'assists'] };
const OPPORTUNITY: Array<{ key: keyof ContextStats; markets: NBAMarket[] }> = [
  { key: 'fga', markets: ['points'] }, { key: 'fta', markets: ['points'] }, { key: 'tpa', markets: ['3pm', 'points'] },
  { key: 'assists', markets: ['assists'] }, { key: 'rebounds', markets: ['rebounds'] }, { key: 'oreb', markets: ['rebounds'] },
  { key: 'dreb', markets: ['rebounds'] }, { key: 'steals', markets: ['steals'] }, { key: 'blocks', markets: ['blocks'] }, { key: 'turnovers', markets: ['turnovers'] },
];

export function buildPlayerOpportunity(env: BuildEnvironment): string[] {
  const recent = env.teamGames.slice(-20);
  const evidenceIds: string[] = [];
  for (const metric of OPPORTUNITY) {
    const rows = recent.flatMap(game => {
      const player = teamPlayer(game, env.request.teamId, env.request.playerId);
      const value = player?.stats[metric.key];
      return player?.didNotPlay === false && value != null && Number.isFinite(value) ? [{ game, player, value }] : [];
    });
    const rates = rows.filter(row => row.player.stats.minutes != null && row.player.stats.minutes > 0).map(row => row.value / row.player.stats.minutes!);
    evidenceIds.push(addEvidence(env, { id: `opportunity.${metric.key}`, metric: `observedPlayer.${metric.key}`, markets: metric.markets,
      value: rows.length ? { perGame: describe(rows.map(row => row.value)), perMinute: describe(rates) } : null,
      detail: `Historical ${metric.key} volume/rate in covered played games. This is not official usage rate, potential assists or rebound chances.`,
      sourceRefs: sources(rows.map(row => row.game)), sample: sample(env, recent, rows.length), state: rows.length === recent.length && recent.length ? 'AVAILABLE' : 'PARTIAL',
      dependencyIds: ['rotation.minutes.l20'], correlationGroup: `opportunity.${metric.key}` }));
  }
  const shares = recent.flatMap(game => {
    const team = game.teams.find(team => team.teamId === env.request.teamId);
    const player = teamPlayer(game, env.request.teamId, env.request.playerId);
    return player?.didNotPlay === false && player.stats.fga != null && team?.stats.fga != null && team.stats.fga > 0
      ? [{ game, share: player.stats.fga / team.stats.fga }] : [];
  });
  evidenceIds.push(addEvidence(env, { id: 'opportunity.shotShare', metric: 'teamFieldGoalAttemptShare', markets: ['points'], value: shares.length ? { mean: mean(shares.map(row => row.share)), n: shares.length } : null,
    units: 'fraction of team FGA', detail: 'Observed share of team field-goal attempts. Not official USG%, touches or a future shot allocation.', sourceRefs: sources(shares.map(row => row.game)), sample: sample(env, recent, shares.length), dependencyIds: ['opportunity.fga'], correlationGroup: 'opportunity.fga' }));
  for (const [id, metric, markets, detail] of [
    ['potentialAssists', 'potentialAssists', ['assists'], 'Actual assists do not reveal potential assists, touches or ball-handling time.'],
    ['reboundChances', 'reboundChances', ['rebounds'], 'Rebounds and team misses do not reveal individual rebound chances.'],
    ['lineupSize', 'confirmedLineupSize', ['rebounds', 'points'], 'Historical starter flags do not establish upcoming lineup size, assignments or spacing.'],
  ] as Array<[string, string, NBAMarket[], string]>) evidenceIds.push(addEvidence(env, { id: `opportunity.${id}`, metric, markets, detail, correlationGroup: `opportunity.${id}` }));
  return evidenceIds;
}

export function buildMarketViews(env: BuildEnvironment): NBAResearchContext['marketViews'] {
  return Object.fromEntries(ALL_MARKETS.map(market => {
    const relevant = new Set([market, ...(COMPONENTS[market] ?? [])]);
    const entries = env.evidence.filter(entry => entry.markets.some(supported => relevant.has(supported)));
    return [market, { evidenceIds: [...new Set(entries.map(entry => entry.id))],
      missing: [...new Set(entries.flatMap(entry => entry.missingReasons))],
      correlationGroups: [...new Set(entries.map(entry => entry.correlationGroup))],
      groupedEvidence: Object.fromEntries([...new Set(entries.map(entry => entry.correlationGroup))].map(group => [group, entries.filter(entry => entry.correlationGroup === group).map(entry => entry.id)])) }];
  })) as NBAResearchContext['marketViews'];
}