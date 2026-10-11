import { addEvidence, describe, sample, sources } from './evidence';
import type { BuildEnvironment, ContextStats, NBAMarket, OpponentContext } from './types';

const ALLOWANCE: Array<{ key: keyof ContextStats; markets: NBAMarket[] }> = [
  { key: 'points', markets: ['points'] }, { key: 'rebounds', markets: ['rebounds'] },
  { key: 'assists', markets: ['assists'] }, { key: 'tpa', markets: ['3pm', 'points', 'rebounds'] },
  { key: 'tpm', markets: ['3pm', 'points'] }, { key: 'oreb', markets: ['rebounds'] }, { key: 'dreb', markets: ['rebounds'] },
  { key: 'fga', markets: ['points', 'rebounds'] }, { key: 'fta', markets: ['points'] },
];

export function buildOpponent(env: BuildEnvironment): OpponentContext {
  const { target } = env.snapshot;
  const opponentTeamId = env.request.teamId === target.homeTeamId ? target.awayTeamId : env.request.teamId === target.awayTeamId ? target.homeTeamId : null;
  const games = env.games.filter(game => game.homeTeamId === opponentTeamId || game.awayTeamId === opponentTeamId).slice(-20);
  const rows = games.flatMap(game => {
    const own = game.teams.find(team => team.teamId === opponentTeamId);
    const against = game.teams.find(team => team.teamId !== opponentTeamId && (team.teamId === game.homeTeamId || team.teamId === game.awayTeamId));
    return own && against ? [{ game, own, against }] : [];
  });
  const evidenceIds: string[] = [];
  const offensiveProfile = rows.filter(row => row.own.stats.fga != null && row.own.stats.fga > 0 && row.own.stats.tpa != null && row.own.stats.tpa <= row.own.stats.fga);
  evidenceIds.push(addEvidence(env, { id: 'opponent.offense.shotMix', metric: 'opponentOffensiveThreePointAttemptShare', markets: ['rebounds', 'points'],
    value: offensiveProfile.length ? describe(offensiveProfile.map(row => row.own.stats.tpa! / row.own.stats.fga!)) : null, units: 'fraction of FGA',
    detail: 'Opponent own offensive 3PA/FGA profile, separate from defensive three-point allowance. It does not determine rebound location or expected pace.',
    sourceRefs: sources(offensiveProfile.map(row => row.game)), sample: sample(env, games, offensiveProfile.length), correlationGroup: 'environment.rebounds' }));
  const ownPoints = rows.filter(row => row.own.stats.points != null);
  evidenceIds.push(addEvidence(env, { id: 'opponent.offense.points', metric: 'opponentOffensivePoints', value: ownPoints.length ? describe(ownPoints.map(row => row.own.stats.points!)) : null,
    units: 'points per game', detail: 'Opponent own offensive production, not defensive allowance, expected game total or blowout probability.', sourceRefs: sources(ownPoints.map(row => row.game)), sample: sample(env, games, ownPoints.length), correlationGroup: 'environment.scoring' }));
  for (const metric of ALLOWANCE) {
    const measured = rows.filter(row => row.against.stats[metric.key] != null);
    evidenceIds.push(addEvidence(env, { id: `opponent.allowed.${metric.key}`, metric: `opponentAllowed.${metric.key}`, markets: metric.markets,
      value: measured.length ? describe(measured.map(row => row.against.stats[metric.key]!)) : null,
      units: 'per game', detail: `Actual opposing-team ${metric.key} in games against opponent ${opponentTeamId ?? 'unknown'}. Not the opponent's own offensive average, not position-specific defense, and not schedule-adjusted. Overtime is included.`,
      sourceRefs: sources(measured.map(row => row.game)), sample: sample(env, games, measured.length), state: measured.length < games.length ? 'PARTIAL' : 'AVAILABLE', correlationGroup: `matchup.${metric.key}` }));
  }
  const paint = rows.filter(row => row.against.paintPoints != null);
  evidenceIds.push(addEvidence(env, { id: 'opponent.allowed.paint', metric: 'opponentAllowed.paintPoints', markets: ['points'],
    value: paint.length ? describe(paint.map(row => row.against.paintPoints!)) : null, units: 'points per game',
    detail: 'Opposing-team points in paint. Not rim-attempt frequency, rim accuracy, individual matchup assignment or defensive scheme.', sourceRefs: sources(paint.map(row => row.game)), sample: sample(env, games, paint.length), correlationGroup: 'matchup.scoring' }));
  const misses = rows.filter(row => row.own.stats.fga != null && row.own.stats.fgm != null && row.own.stats.fga >= row.own.stats.fgm);
  evidenceIds.push(addEvidence(env, { id: 'opponent.shotMisses', metric: 'opponentFieldGoalMisses', markets: ['rebounds'],
    value: misses.length ? describe(misses.map(row => row.own.stats.fga! - row.own.stats.fgm!)) : null, units: 'misses per game',
    detail: 'Opponent offensive missed field goals are a rebounding-environment proxy, not player rebound chances or live-ball rebound opportunities.', sourceRefs: sources(misses.map(row => row.game)), sample: sample(env, games, misses.length), correlationGroup: 'environment.rebounds' }));
  const possessionEstimate = (stats: ContextStats) => stats.fga != null && stats.fta != null && stats.oreb != null && stats.turnovers != null ? stats.fga + 0.44 * stats.fta - stats.oreb + stats.turnovers : null;
  const pace = rows.flatMap(row => {
    const first = possessionEstimate(row.own.stats);
    const second = possessionEstimate(row.against.stats);
    const periods = Math.max(0, ...row.game.plays.map(play => play.period ?? 0));
    return first != null && second != null && periods >= 4 && periods <= 10 ? [{ ...row, estimate: ((first + second) / 2) * 48 / (48 + (periods - 4) * 5) }] : [];
  });
  evidenceIds.push(addEvidence(env, { id: 'opponent.paceEstimate', metric: 'estimatedTeamPossessionsPer48', value: pace.length ? describe(pace.map(row => row.estimate)) : null, units: 'estimated possessions per 48 minutes',
    detail: 'Boxscore proxy: mean of both teams\' (FGA + 0.44*FTA - OREB + total turnovers), normalized for verified overtime. Not official pace or an expected game total.',
    sourceRefs: sources(pace.map(row => row.game)), sample: sample(env, games, pace.length), reliability: 'LOW', correlationGroup: 'environment.pace' }));
  for (const [metric, detail] of [
    ['positionMatchup', 'Boxscore position labels do not establish game-time defensive assignments or positional allowance.'],
    ['rimProfile', 'Paint totals do not supply rim attempts or rim defense.'],
    ['defensiveScheme', 'Switch/drop/zone coverage and assigned defenders are not connected.'],
    ['spreadTotal', 'No external pregame spread/total snapshot is supplied. No sportsbook fetching or expected game-script/blowout probability is computed.'],
  ]) evidenceIds.push(addEvidence(env, { id: `opponent.${metric}`, metric, detail, correlationGroup: 'environment.gameScript' }));
  return { opponentTeamId, evidenceIds };
}