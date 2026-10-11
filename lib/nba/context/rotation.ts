import { addEvidence, describe, sample, sources } from './evidence';
import type { BuildEnvironment, ContextGame, PlayerObservation, RotationContext } from './types';

export function teamPlayer(game: ContextGame, teamId: number, playerId: number): PlayerObservation | null {
  return game.teams.find(team => team.teamId === teamId)?.players.find(player => player.playerId === playerId) ?? null;
}

export function reconstructRotation(game: ContextGame, teamId: number): { state: 'AVAILABLE' | 'UNAVAILABLE'; reason: string; byPlayer: Record<number, { minutes: number; periods: Record<number, number>; exits: Array<{ period: number; secondsRemaining: number; margin: number | null }> }> } {
  const unavailable = (reason: string) => ({ state: 'UNAVAILABLE' as const, reason, byPlayer: {} });
  const team = game.teams.find(team => team.teamId === teamId);
  if (!team?.rosterComplete || !game.completed || !game.completedAt) return unavailable('Complete starter/participation rows and final completion proof required.');
  const starters = team.players.filter(player => player.starter === true && player.didNotPlay === false);
  if (starters.length !== 5) return unavailable('Exactly five verified starters required.');
  const plays = [...game.plays].sort((first, second) => first.sequence - second.sequence);
  if (!plays.length || plays.some(play => !Number.isFinite(play.sequence) || play.period == null || play.secondsRemaining == null)
    || new Set(plays.map(play => play.sequence)).size !== plays.length) return unavailable('Incomplete or ambiguous play sequence.');
  const lastPeriod = Math.max(...plays.map(play => play.period!));
  if (lastPeriod < 4 || lastPeriod > 10) return unavailable('Unsupported or incomplete period coverage.');
  const elapsed = (period: number, remaining: number) => (period <= 4 ? (period - 1) * 720 : 2880 + (period - 5) * 300) + (period <= 4 ? 720 : 300) - remaining;
  const court = new Set(starters.map(player => player.playerId));
  const byPlayer: Record<number, { minutes: number; periods: Record<number, number>; exits: Array<{ period: number; secondsRemaining: number; margin: number | null }> }> = {};
  const playerRecord = (id: number) => byPlayer[id] ??= { minutes: 0, periods: {}, exits: [] };
  let previous = 0;
  for (const play of plays) {
    const period = play.period!;
    const remaining = play.secondsRemaining!;
    const length = period <= 4 ? 720 : 300;
    if (period < 1 || remaining < 0 || remaining > length) return unavailable('Invalid period clock.');
    const current = elapsed(period, remaining);
    if (current < previous) return unavailable('Non-monotonic game clock.');
    let cursor = previous;
    while (cursor < current) {
      const spanPeriod = cursor < 2880 ? Math.floor(cursor / 720) + 1 : Math.floor((cursor - 2880) / 300) + 5;
      const end = spanPeriod <= 4 ? spanPeriod * 720 : 2880 + (spanPeriod - 4) * 300;
      const seconds = Math.min(end, current) - cursor;
      for (const id of court) {
        const stats = playerRecord(id);
        stats.minutes += seconds / 60;
        stats.periods[spanPeriod] = (stats.periods[spanPeriod] ?? 0) + seconds / 60;
      }
      cursor += seconds;
    }
    previous = current;
    if (play.teamId === teamId && /substitution/i.test(play.type)) {
      const matching = team.players.flatMap(incoming => team.players.filter(outgoing => incoming.playerId !== outgoing.playerId
        && play.text === `${incoming.name} enters the game for ${outgoing.name}`).map(outgoing => ({ incoming, outgoing })));
      if (matching.length !== 1) return unavailable('Substitution in/out attribution cannot be verified from exact names.');
      const { incoming, outgoing } = matching[0];
      if (!play.participantIds.includes(incoming.playerId) || !play.participantIds.includes(outgoing.playerId)
        || !court.has(outgoing.playerId) || court.has(incoming.playerId)) return unavailable('Substitution participants or on-court state disagree.');
      court.delete(outgoing.playerId);
      court.add(incoming.playerId);
      playerRecord(outgoing.playerId).exits.push({ period, secondsRemaining: remaining,
        margin: play.homeScore != null && play.awayScore != null ? Math.abs(play.homeScore - play.awayScore) : null });
    } else if (/substitution/i.test(play.type) && play.teamId == null) return unavailable('Substitution team identity missing.');
  }
  if (previous !== (lastPeriod <= 4 ? 2880 : 2880 + (lastPeriod - 4) * 300)) return unavailable('Missing final period boundary.');
  for (let period = 1; period <= lastPeriod; period += 1) {
    if (!plays.some(play => play.period === period && play.secondsRemaining === 0 && /end/i.test(`${play.type} ${play.text}`))) return unavailable('Missing intermediate period boundary.');
  }
  for (const player of team.players.filter(player => player.didNotPlay === false)) {
    if (player.stats.minutes == null || Math.abs((byPlayer[player.playerId]?.minutes ?? 0) - player.stats.minutes) > 1) return unavailable('Stint totals do not reconcile with rounded boxscore minutes.');
  }
  return { state: 'AVAILABLE', reason: 'Validated substitution sequence and boxscore reconciliation; rounded minutes allow one-minute tolerance.', byPlayer };
}

export function buildRotation(env: BuildEnvironment): RotationContext {
  const { playerId, teamId } = env.request;
  const rows = env.teamGames.map(game => ({ game, player: teamPlayer(game, teamId, playerId) }));
  const played = rows.filter(row => row.player?.didNotPlay === false && row.player.stats.minutes != null && row.player.stats.minutes > 0);
  const dnps = rows.filter(row => row.player?.didNotPlay === true);
  const unknown = rows.filter(row => !row.player || row.player.didNotPlay == null || row.player.didNotPlay === false && (row.player.stats.minutes == null || row.player.stats.minutes <= 0));
  const recent = played.slice(-10);
  const started = recent.filter(row => row.player!.starter === true);
  const benched = recent.filter(row => row.player!.starter === false);
  const recentRole = started.length === recent.length && recent.length ? 'STARTER' : benched.length === recent.length && recent.length ? 'BENCH' : started.length + benched.length === recent.length && recent.length ? 'MIXED' : 'UNKNOWN';
  const evidenceIds: string[] = [];
  evidenceIds.push(addEvidence(env, { id: 'rotation.participation', metric: 'participation', correlationGroup: 'minutes.role', kind: 'FACT',
    value: { played: played.length, dnp: dnps.length, unknown: unknown.length, dnpReasons: dnps.map(row => ({ gameId: row.game.gameId, reason: row.player!.dnpReason })) },
    detail: 'Explicit DNP is distinct from a missing player row; missing data is not nonparticipation.', sourceRefs: sources(env.teamGames), sample: sample(env, env.teamGames, rows.length - unknown.length),
    state: unknown.length ? 'PARTIAL' : 'AVAILABLE', reliability: unknown.length ? 'LOW' : 'MEDIUM' }));
  for (const size of [3, 5, 10, 20]) {
    const selected = played.slice(-size);
    const values = selected.map(row => row.player!.stats.minutes!);
    evidenceIds.push(addEvidence(env, { id: `rotation.minutes.l${size}`, metric: 'observedMinutes', correlationGroup: 'minutes.role',
      value: values.length ? describe(values) : null, units: 'minutes', detail: `Last ${size} covered played games; descriptive minutes distribution, not expected minutes. DNPs excluded, coverage disclosed.`,
      sourceRefs: sources(selected.map(row => row.game)), sample: sample(env, selected.map(row => row.game), values.length, ['played with measured minutes']),
      state: selected.length < size ? 'PARTIAL' : 'AVAILABLE' }));
  }
  evidenceIds.push(addEvidence(env, { id: 'rotation.starts', metric: 'historicalRole', correlationGroup: 'minutes.role', kind: 'FACT',
    value: recent.length ? { role: recentRole, starts: started.length, bench: benched.length, unknown: recent.length - started.length - benched.length } : null,
    detail: 'Historical start/bench flags do not confirm the upcoming lineup.', sourceRefs: sources(recent.map(row => row.game)), sample: sample(env, recent.map(row => row.game), started.length + benched.length) }));
  const baseline = played.slice(0, -5);
  const last5 = played.slice(-5);
  const baselineSummary = describe(baseline.map(row => row.player!.stats.minutes!));
  const recentSummary = describe(last5.map(row => row.player!.stats.minutes!));
  evidenceIds.push(addEvidence(env, { id: 'rotation.change', metric: 'observedMinutesChange', correlationGroup: 'minutes.role',
    value: baselineSummary.mean != null && recentSummary.mean != null ? { baseline: baselineSummary, recent: recentSummary, difference: recentSummary.mean - baselineSummary.mean } : null,
    detail: 'Non-overlapping recent and prior minutes samples; no cause, coaching change or future role is assumed.', sourceRefs: sources(played.map(row => row.game)), sample: sample(env, played.map(row => row.game), Math.min(baseline.length, last5.length)) }));
  const stintGames = recent.map(row => ({ ...row, reconstruction: reconstructRotation(row.game, teamId) }));
  const validated = stintGames.filter(row => row.reconstruction.state === 'AVAILABLE');
  evidenceIds.push(addEvidence(env, { id: 'rotation.stints', metric: 'observedPeriodMinutes', correlationGroup: 'minutes.role',
    value: validated.length ? validated.map(row => ({ gameId: row.game.gameId, ...row.reconstruction.byPlayer[playerId] })) : null,
    detail: 'Validated period participation and exit-score margins. Late exits alongside a margin are observations, not proof of blowout-caused minutes.',
    sourceRefs: sources(validated.map(row => row.game)), sample: sample(env, recent.map(row => row.game), validated.length),
    state: validated.length === recent.length && recent.length ? 'AVAILABLE' : 'PARTIAL',
    missingReasons: stintGames.filter(row => row.reconstruction.state !== 'AVAILABLE').map(row => `${row.game.gameId}: ${row.reconstruction.reason}`) }));
  const lastPlayed = played.at(-1);
  const precedingDnp = lastPlayed && dnps.filter(row => Date.parse(row.game.startsAt) < Date.parse(lastPlayed.game.startsAt)).at(-1);
  evidenceIds.push(addEvidence(env, { id: 'rotation.return', metric: 'participationAfterDnp', correlationGroup: 'minutes.role', kind: 'FACT',
    value: precedingDnp && lastPlayed ? { lastDnp: precedingDnp.game.gameId, playedAfter: lastPlayed.game.gameId, minutes: lastPlayed.player!.stats.minutes, reportedDnpReason: precedingDnp.player!.dnpReason } : null,
    detail: 'Participation after a documented DNP does not establish medical clearance, an injury return, or a future minutes restriction.', sourceRefs: sources(precedingDnp && lastPlayed ? [precedingDnp.game, lastPlayed.game] : []) }));
  evidenceIds.push(addEvidence(env, { id: 'rotation.currentLineup', metric: 'confirmedUpcomingStarter', correlationGroup: 'minutes.role', state: 'UNKNOWN', detail: 'Historical starts cannot confirm an upcoming lineup. No verified current lineup source is connected.' }));
  evidenceIds.push(addEvidence(env, { id: 'rotation.coaching', metric: 'coachingRotationChange', correlationGroup: 'minutes.role', state: 'UNKNOWN', detail: 'A minutes change does not prove a coaching change or policy. Date-attributed coach identity and verified comments are not connected.' }));
  return { currentStarter: 'UNKNOWN', restriction: 'UNKNOWN', recentRole, playedGames: played.length, dnpGames: dnps.length, missingGames: unknown.length, evidenceIds };
}