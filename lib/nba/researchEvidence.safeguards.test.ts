import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildNBAResearchContext } from './context/engine';
import { buildNBAIntelligence } from './intelligence/engine';
import { availabilityFixture, availabilityTime } from './prediction/gameLines/availability.fixtures';
import { buildNBAResearchEvidence, type NBAResearchEvidence } from './researchEvidence';

let blockedFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(availabilityTime));
  blockedFetch = vi.fn(() => { throw new Error('Network forbidden in evidence safeguards'); });
  vi.stubGlobal('fetch', blockedFetch);
});

afterEach(() => {
  try { expect(blockedFetch).not.toHaveBeenCalled(); }
  finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
});

function inputs(scenario: Parameters<typeof availabilityFixture>[0] = 'healthy') {
  const fixture = availabilityFixture(scenario);
  return { gameId: 'target', market: 'points' as const, playerId: 101, teamIds: [1, 2],
    asOf: availabilityTime, targetTipoff: fixture.snapshot.target.startsAt,
    context: structuredClone(buildNBAResearchContext({ playerId: 101, teamId: 1, gameId: 'target', asOf: availabilityTime }, fixture.snapshot)),
    intelligence: structuredClone(fixture.intelligence) };
}

function assertDescriptiveOnly(evidence: NBAResearchEvidence) {
  for (const section of [evidence, evidence.context, evidence.intelligence]) {
    for (const field of ['probability', 'probabilities', 'trueProbability', 'expectedStat', 'ev', 'evPercent',
      'expectedValuePercent', 'researchScore', 'pickTier', 'valueQualified']) expect(section).not.toHaveProperty(field);
  }
}

describe('NBA descriptive evidence candidate-cutoff safeguards', () => {
  it('does not preserve positive summary labels when their source evidence was learned after cutoff', () => {
    const input = inputs();
    input.context.sections.availability = { status: 'AVAILABLE', state: 'AVAILABLE', evidenceIds: ['availability.current'] };
    const affected = new Set([...input.context.sections.availability.evidenceIds, ...input.context.sections.rotation.evidenceIds]);
    for (const entry of input.context.evidence.filter(entry => affected.has(entry.id))) {
      entry.state = 'AVAILABLE';
      entry.sourceRefs = [{ ...input.context.evidence[0].sourceRefs[0], id: 'future-source', provider: 'ESPN',
        url: 'https://site.api.espn.com/fixture', recordId: 'target', publishedAt: null, updatedAt: null,
        fetchedAt: '2026-01-21T18:01:00Z', freshness: 'AFTER_CUTOFF' }];
    }
    const result = buildNBAResearchEvidence(input);
    expect(result.context.availability).toEqual({ status: 'UNKNOWN', state: 'UNAVAILABLE' });
    expect(result.context.rotation?.recentRole).toBe('UNKNOWN');
    expect(result.context.evidence.filter(entry => affected.has(entry.id)).every(entry => entry.state === 'UNAVAILABLE' && entry.value == null)).toBe(true);
    assertDescriptiveOnly(result);
  });
  it.each([
    ['schema', { schemaVersion: '2' }], ['sport', { sport: 'nfl' }], ['player', { playerId: 999 }],
    ['game', { gameId: 'other' }], ['team', { teamId: 999 }],
  ])('rejects context with the wrong %s identity', (_label, mismatch) => {
    const input = inputs();
    Object.assign(input.context, mismatch);
    const result = buildNBAResearchEvidence(input);
    expect(result.context).toMatchObject({ state: 'UNAVAILABLE', asOf: null, cutoff: null, availability: null,
      rotation: null, injuryNetwork: null, opponentTeamId: null, evidence: [] });
    expect(result.context.missing).toEqual(expect.arrayContaining([expect.stringContaining('identity did not match')]));
    assertDescriptiveOnly(result);
  });

  it.each(['schema', 'sport', 'game', 'home team', 'away team'] as const)('rejects intelligence with the wrong %s identity', field => {
    const input = inputs();
    if (field === 'schema') Object.assign(input.intelligence, { schemaVersion: '2' });
    if (field === 'sport') Object.assign(input.intelligence, { sport: 'nfl' });
    if (field === 'game') input.intelligence.target.gameId = 'other';
    if (field === 'home team') input.intelligence.target.homeTeamId = 999;
    if (field === 'away team') input.intelligence.target.awayTeamId = 999;
    const result = buildNBAResearchEvidence(input);
    expect(result.intelligence).toMatchObject({ state: 'UNAVAILABLE', asOf: null, cutoff: null, reports: [],
      lineups: [], evidence: [], affectedTeammates: [] });
    assertDescriptiveOnly(result);
  });

  it.each(['unrelated player and team', 'wrong game'] as const)('excludes injury claims for %s', mismatch => {
    const input = inputs();
    input.intelligence.claims = input.intelligence.claims.filter(record => record.claim.topic === 'INJURY');
    expect(input.intelligence.claims.length).toBeGreaterThan(0);
    for (const record of input.intelligence.claims) {
      if (mismatch === 'wrong game') record.claim.gameId = 'other';
      else { record.claim.playerIds = [999]; record.claim.teamId = 999; }
    }
    const result = buildNBAResearchEvidence(input);
    expect(result.intelligence.reports.filter(report => report.topic === 'INJURY')).toEqual([]);
    assertDescriptiveOnly(result);
  });

  it.each(['context', 'intelligence'] as const)('rejects a future %s snapshot even before target tipoff', section => {
    const input = inputs();
    input[section].asOf = '2026-01-21T18:01:00Z';
    input[section].cutoff = '2026-01-21T18:01:00Z';
    expect(Date.parse(input[section].asOf)).toBeLessThan(Date.parse(input.targetTipoff));
    const result = buildNBAResearchEvidence(input);
    expect(result[section].state).toBe('UNAVAILABLE');
    expect(result[section].asOf).toBeNull();
    expect(result[section].evidence).toEqual([]);
    if (section === 'intelligence') {
      expect(result.intelligence.reports).toEqual([]);
      expect(result.intelligence.lineups).toEqual([]);
    }
    assertDescriptiveOnly(result);
  });

  it.each(['INJURY', 'LINEUP'] as const)('excludes a future-published %s even when its updated timestamp is older', topic => {
    const input = inputs();
    const matching = input.intelligence.claims.filter(record => record.claim.topic === topic && record.claim.teamId === 1);
    expect(matching.length).toBeGreaterThan(0);
    const excludedIds = matching.map(record => record.claim.id);
    for (const record of matching) {
      record.document.publishedAt = '2026-01-21T18:01:00Z';
      record.document.updatedAt = '2026-01-21T17:00:00Z';
    }
    const result = buildNBAResearchEvidence(input);
    expect(result.intelligence.reports.filter(report => excludedIds.includes(report.claimId))).toEqual([]);
    expect(result.intelligence.evidence.flatMap(entry => entry.claimIds).filter(id => excludedIds.includes(id))).toEqual([]);
    expect(result.intelligence.missing).toEqual(expect.arrayContaining([expect.stringContaining('after the target cutoff')]));
    if (topic === 'LINEUP') expect(result.intelligence.lineups.find(lineup => lineup.teamId === 1))
      .toMatchObject({ level: 'UNKNOWN', state: 'UNKNOWN', playerIds: [] });
    assertDescriptiveOnly(result);
  });

  it('marks future-published context evidence unavailable despite an older update', () => {
    const input = inputs();
    const rest = input.context.evidence.find(entry => entry.id === 'schedule.rest')!;
    expect(rest.sourceRefs.length).toBeGreaterThan(0);
    rest.sourceRefs[0].publishedAt = '2026-01-21T18:01:00Z';
    rest.sourceRefs[0].updatedAt = '2026-01-21T17:00:00Z';
    const result = buildNBAResearchEvidence(input);
    expect(result.context.evidence.find(entry => entry.id === rest.id)).toMatchObject({ kind: 'UNAVAILABLE', state: 'UNAVAILABLE', value: null });
    expect(result.context.evidence.find(entry => entry.id === rest.id)?.sourceRefs)
      .not.toEqual(expect.arrayContaining([expect.objectContaining({ publishedAt: '2026-01-21T18:01:00Z' })]));
    assertDescriptiveOnly(result);
  });

  it('keeps stale injury and lineup reports STALE without producing numeric probabilities', () => {
    const result = buildNBAResearchEvidence(inputs('stale'));
    expect(result.intelligence.reports).toEqual(expect.arrayContaining(['INJURY', 'LINEUP'].map(topic =>
      expect.objectContaining({ topic, state: 'STALE', source: expect.objectContaining({ url: expect.stringContaining('https://') }) }))));
    expect(result.intelligence.reports.filter(report => report.state === 'CURRENT')).toEqual([]);
    expect(result.intelligence.lineups).toEqual(expect.arrayContaining([expect.objectContaining({ teamId: 1,
      level: 'UNKNOWN', state: 'STALE', playerIds: [] })]));
    expect(result.intelligence.state).toBe('PARTIAL');
    assertDescriptiveOnly(result);
  });

  it('rechecks freshness at candidate observation time rather than trusting a stored CURRENT label', () => {
    const input = inputs('stale');
    for (const record of input.intelligence.claims) record.state = 'CURRENT';
    const result = buildNBAResearchEvidence(input);
    expect(result.intelligence.reports.length).toBeGreaterThan(0);
    expect(result.intelligence.reports.every(report => report.state === 'STALE')).toBe(true);
    expect(result.intelligence.reports.every(report => report.reasons.includes('Statement exceeded descriptive research freshness policy.'))).toBe(true);
    assertDescriptiveOnly(result);
  });

  it('retains a sourced projected lineup as PROJECTED, never as a confirmed starting five', () => {
    const result = buildNBAResearchEvidence(inputs('projected'));
    expect(result.intelligence.reports).toEqual(expect.arrayContaining([expect.objectContaining({ topic: 'LINEUP',
      state: 'CURRENT', qualifier: 'PROJECTED', lineupLevel: 'PROJECTED', verification: 'SPECULATION' })]));
    expect(result.intelligence.lineups).toHaveLength(2);
    for (const lineup of result.intelligence.lineups) expect(lineup).toMatchObject({ level: 'PROJECTED', state: 'CURRENT' });
    expect(result.intelligence.lineups.some(lineup => lineup.level === 'OFFICIALLY_CONFIRMED')).toBe(false);
    assertDescriptiveOnly(result);
  });

  it('never infers healthy availability from an unavailable injury feed and absent reviewed reports', () => {
    const fixture = availabilityFixture();
    expect(fixture.snapshot.injuryFeed.state).toBe('UNAVAILABLE');
    const input = inputs();
    input.intelligence = structuredClone(buildNBAIntelligence({ ...fixture.rawInput, documents: [], claims: [] }));
    const result = buildNBAResearchEvidence(input);
    expect(result.context.availability?.status).toBe('UNKNOWN');
    expect(result.context.availability?.state).toBe('UNKNOWN');
    expect(result.context.evidence.find(entry => entry.id === 'availability.current'))
      .toMatchObject({ kind: 'UNAVAILABLE', state: 'UNKNOWN', value: null });
    expect(result.intelligence.reports).toEqual([]);
    expect(result.intelligence.lineups.every(lineup => lineup.level === 'UNKNOWN')).toBe(true);
    expect(result.context.missing.length + result.intelligence.missing.length).toBeGreaterThan(0);
    assertDescriptiveOnly(result);
  });
});