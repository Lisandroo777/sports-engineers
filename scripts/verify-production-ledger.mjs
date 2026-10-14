import assert from 'node:assert/strict';

export async function verifyLedger({ sign, verify, capture, repository }, now = new Date()) {
  const kickoff = new Date(now.getTime() + 86400000).toISOString();
  const candidate = {
    candidateId: 'isolated-diagnostic-candidate', gameId: 'isolated-diagnostic-game', playerId: 1,
    player: 'Diagnostic record; not a recommendation', team: 'Diagnostic Home', opponent: 'Diagnostic Away',
    market: 'Passing Yards', marketKey: 'player_pass_yds', line: 200.5, direction: 'over',
    book: 'Diagnostic Book', odds: -110, projection: 210, trueProbability: 55,
    modelProbability: 55, edge: 9.5, evPercent: 5, researchScore: 80, trapRisk: 10, pickTier: 'EDGE',
    game: { id: 'isolated-diagnostic-game', gameTime: kickoff, season: now.getUTCFullYear(), week: 1, seasonType: 'REGULAR', completed: false },
  };
  const token = sign({ issuedAt: now.toISOString(), researchSessionId: 'isolated-diagnostic-session',
    rankingIntent: 'BEST', researchMode: 'STANDARD', rows: [{ candidate, kickoff: { time: kickoff, source: 'ISOLATED_DIAGNOSTIC' } }] }, now.getTime());
  assert.ok(verify(token, now.getTime()));
  assert.equal(verify(`${token}tampered`, now.getTime()), null);
  const first = await capture(token, [candidate.candidateId], now);
  assert.equal(first.created, 1);
  assert.equal(first.duplicates, 0);
  const duplicate = await capture(token, [candidate.candidateId], now);
  assert.equal(duplicate.created, 0);
  assert.equal(duplicate.duplicates, 1);
  const restored = await repository.get(first.records[0].snapshot.predictionId);
  assert.equal(restored.snapshot.player, candidate.player);
  assert.equal(restored.snapshot.researchSessionId, 'isolated-diagnostic-session');
  assert.equal(restored.currentGrade, 'PENDING');
  assert.equal((await repository.list()).length, 1);
  return { signedReceipt: true, tamperRejected: true, durableCapture: true, duplicatePrevented: true };
}