import type { GameModelInput, GameProjection, ScoreScenario } from './types';
import { GAME_MODEL_VERSION } from './types';
import { average, phaseOf, selectTeamGames, teamProfile, teamSamples } from './history';

export function projectNBAGame(input: GameModelInput): GameProjection {
  const { target } = input.snapshot;
  const predictionTime = Date.parse(input.predictionAt);
  const targetTime = Date.parse(target.startsAt);
  const result: GameProjection = { modelVersion: GAME_MODEL_VERSION, validationStatus: 'UNVALIDATED', status: 'INVALID_INPUT',
    gameId: target.gameId, homeTeamId: target.homeTeamId, awayTeamId: target.awayTeamId, seasonId: target.seasonId,
    phase: phaseOf(target), startsAt: target.startsAt, predictionAt: input.predictionAt, profiles: null, expectedPossessions: null,
    means: null, epistemicPriorWeight: null, uncertainty: null, homeWinProbability: null, scenarios: [], exclusions: [], intelligenceSnapshotId: null,
    risks: ['Possessions are a boxscore proxy, not official pace.', 'Opponent schedule strength is not adjusted.',
      'Rest and venue sequence are descriptive; travel itinerary and fatigue effects are unmodeled.',
      'Empirical residual tails and all fixed smoothing weights are UNVALIDATED.', 'Overtime history is excluded; tied simulations use an unvalidated symmetric overtime resolution.',
      'Joint epistemic prior weight 2/(min(team sample sizes)+2) and 12-point minimum prior score spread are UNVALIDATED assumptions; scenarios are not independent game evidence.'] };
  if (!target.gameId || ![target.homeTeamId, target.awayTeamId].every(id => Number.isInteger(id) && id > 0)
    || target.homeTeamId === target.awayTeamId || !target.seasonId || !/^\d{4}$/.test(target.seasonId) || !Number.isFinite(predictionTime)
    || !Number.isFinite(targetTime) || predictionTime >= targetTime || target.completed
    || !Number.isFinite(Date.parse(target.source.fetchedAt)) || Date.parse(target.source.fetchedAt) > predictionTime
    || !Number.isFinite(Date.parse(input.snapshot.asOf)) || Date.parse(input.snapshot.asOf) > predictionTime) return result;
  if (!['REGULAR', 'PLAY_IN', 'POSTSEASON'].includes(result.phase)) return { ...result, status: 'UNSUPPORTED_PHASE' };
  const selected = selectTeamGames(input);
  result.exclusions = selected.exclusions;
  const homeRows = teamSamples(selected.games, target.homeTeamId);
  const awayRows = teamSamples(selected.games, target.awayTeamId);
  const usableIds = new Set([...homeRows, ...awayRows].map(row => row.gameId));
  result.exclusions.push(...selected.games.filter(game => !usableIds.has(game.gameId)).map(game => ({ gameId: game.gameId, reason: 'Missing team/score/possession reconciliation, regulation period coverage, overtime, or unrelated game' })));
  if (homeRows.length < 10 || awayRows.length < 10) return { ...result, status: 'INSUFFICIENT_DATA' };
  const home = teamProfile(input, target.homeTeamId, homeRows, true);
  const away = teamProfile(input, target.awayTeamId, awayRows, false);
  const pace = (home.pace + away.pace) / 2;
  const homeMean = pace * (home.offense + away.defense) / 200;
  const awayMean = pace * (away.offense + home.defense) / 200;
  const homeBaseline = { offense: average(homeRows.map(row => row.offensiveEfficiency)), defense: average(homeRows.map(row => row.defensiveEfficiency)) };
  const awayBaseline = { offense: average(awayRows.map(row => row.offensiveEfficiency)), defense: average(awayRows.map(row => row.defensiveEfficiency)) };
  const homeResiduals = homeRows.slice(-30);
  const awayResiduals = awayRows.slice(-30);
  const scenarios: ScoreScenario[] = [];
  const commonPaceSd = Math.max(2, Math.sqrt(average([...homeRows.map(row => (row.possessions - home.pace) ** 2), ...awayRows.map(row => (row.possessions - away.pace) ** 2)])));
  for (const first of homeResiduals) for (const second of awayResiduals) for (const paceShock of [-1, 0, 1]) {
    const environment = (pace + paceShock * commonPaceSd) / pace;
    const homeResidual = pace * ((first.offensiveEfficiency - homeBaseline.offense) + (second.defensiveEfficiency - awayBaseline.defense)) / (100 * Math.sqrt(2));
    const awayResidual = pace * ((second.offensiveEfficiency - awayBaseline.offense) + (first.defensiveEfficiency - homeBaseline.defense)) / (100 * Math.sqrt(2));
    const homeScore = Math.max(0, Math.round(homeMean * environment + homeResidual));
    const awayScore = Math.max(0, Math.round(awayMean * environment + awayResidual));
    const weight = (paceShock === 0 ? 2 / 3 : 1 / 6) / (homeResiduals.length * awayResiduals.length);
    if (homeScore === awayScore) {
      scenarios.push({ homeScore: homeScore + 1, awayScore, weight: weight / 2 }, { homeScore, awayScore: awayScore + 1, weight: weight / 2 });
    } else scenarios.push({ homeScore, awayScore, weight });
  }
  const totalWeight = scenarios.reduce((sum, scenario) => sum + scenario.weight, 0);
  const epistemicPriorWeight = 2 / (Math.min(homeRows.length, awayRows.length) + 2);
  for (const scenario of scenarios) scenario.weight = scenario.weight / totalWeight * (1 - epistemicPriorWeight);
  const center = (homeMean + awayMean) / 2;
  const historicalSpread = Math.sqrt(average([...homeRows.map(row => (row.scored - row.allowed) ** 2), ...awayRows.map(row => (row.scored - row.allowed) ** 2)]) / 2);
  const priorSpread = Math.max(12, historicalSpread);
  for (const homeShock of [-1, 0, 1]) for (const awayShock of [-1, 0, 1]) {
    const homeScore = Math.max(0, Math.round(center + homeShock * Math.sqrt(3) * priorSpread));
    const awayScore = Math.max(0, Math.round(center + awayShock * Math.sqrt(3) * priorSpread));
    const weight = epistemicPriorWeight * (homeShock === 0 ? 2 / 3 : 1 / 6) * (awayShock === 0 ? 2 / 3 : 1 / 6);
    if (homeScore === awayScore) scenarios.push({ homeScore: homeScore + 1, awayScore, weight: weight / 2 }, { homeScore, awayScore: awayScore + 1, weight: weight / 2 });
    else scenarios.push({ homeScore, awayScore, weight });
  }
  const expectation = (get: (row: ScoreScenario) => number) => scenarios.reduce((sum, row) => sum + get(row) * row.weight, 0);
  const homeScore = expectation(row => row.homeScore);
  const awayScore = expectation(row => row.awayScore);
  const variance = (get: (row: ScoreScenario) => number) => { const mean = expectation(get); return expectation(row => (get(row) - mean) ** 2); };
  if (input.snapshot.injuryFeed.state !== 'AVAILABLE') result.risks.push('Current team injury feed unavailable; no healthy-team inference.');
  const knownInjuries = input.snapshot.injuries.filter(report => [target.homeTeamId, target.awayTeamId].includes(report.teamId ?? -1));
  if (knownInjuries.length) result.risks.push('Team injury reports require lineup/impact review; no generic points adjustment applied.');
  const intelligence = input.intelligence;
  if (intelligence && intelligence.schemaVersion === '1' && intelligence.target.gameId === target.gameId
    && intelligence.target.homeTeamId === target.homeTeamId && intelligence.target.awayTeamId === target.awayTeamId
    && Date.parse(intelligence.target.startsAt) === targetTime && Number.isFinite(Date.parse(intelligence.asOf))
    && Number.isFinite(Date.parse(intelligence.cutoff)) && Date.parse(intelligence.asOf) <= predictionTime && Date.parse(intelligence.cutoff) <= predictionTime) {
    result.intelligenceSnapshotId = intelligence.snapshotId;
    result.risks.push(...intelligence.coverage.missing);
    for (const report of intelligence.coaching) result.risks.push(`Coaching evidence: ${report.verification}/${report.state}; not a numerical projection adjustment.`);
    for (const teamId of [target.homeTeamId, target.awayTeamId]) {
      if (!intelligence.lineups.some(lineup => lineup.teamId === teamId && lineup.state === 'CURRENT' && lineup.level === 'OFFICIALLY_CONFIRMED')) result.risks.push(`Team ${teamId}: current starting five not officially confirmed.`);
    }
  } else result.risks.push('Current starting lineups and reviewed coaching intelligence unavailable; no lineup adjustment applied.');
  return { ...result, status: 'AVAILABLE', profiles: { home, away }, expectedPossessions: pace, epistemicPriorWeight, scenarios,
    means: { homeScore, awayScore, margin: homeScore - awayScore, total: homeScore + awayScore },
    uncertainty: { homeScore: Math.sqrt(variance(row => row.homeScore)), awayScore: Math.sqrt(variance(row => row.awayScore)),
      margin: Math.sqrt(variance(row => row.homeScore - row.awayScore)), total: Math.sqrt(variance(row => row.homeScore + row.awayScore)),
      scoreCovariance: expectation(row => (row.homeScore - homeScore) * (row.awayScore - awayScore)) },
    homeWinProbability: expectation(row => Number(row.homeScore > row.awayScore)) };
}