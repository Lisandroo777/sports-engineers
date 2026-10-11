import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildNBAIntelligence } from '../../intelligence/engine';
import { supportedClaim } from '../../intelligence/claims';
import { assessNBAGameAvailability } from './availability';
import { availabilityDependencies, availabilityEvent, availabilityFixture, availabilityGame, availabilityTime, starterIds } from './availability.fixtures';
import { binding, historicalFixture, quote } from './fixtures';
import { assessGameMarket } from './markets';
import { projectNBAGame } from './model';
import { researchNBAGameLines } from './pipeline';
import { classifyGameRecommendation } from './recommendations';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(availabilityTime));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden in availability fixtures'); }));
});
afterEach(() => {
  try { expect(fetch).not.toHaveBeenCalled(); }
  finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
});

describe('real Agent #2 NBA game availability evidence', () => {
  it('preserves identical scoring math across explicit regular/postseason cohorts and does not enable preseason', () => {
    const fixture = availabilityFixture();
    const baseline = projectNBAGame({ snapshot: fixture.snapshot, predictionAt: availabilityTime });
    const postseason = structuredClone(fixture.snapshot);
    for (const game of [postseason.target, ...postseason.games]) game.phase = 'POSTSEASON';
    const playoffModel = projectNBAGame({ snapshot: postseason, predictionAt: availabilityTime });
    expect(playoffModel.status).toBe('AVAILABLE');
    expect(playoffModel.scenarios).toEqual(baseline.scenarios);
    expect(playoffModel.means).toEqual(baseline.means);
    expect(assessNBAGameAvailability(postseason, fixture.intelligence).phase).toMatchObject({ verified: true, phase: 'POSTSEASON' });
    postseason.target.phase = 'PRESEASON';
    expect(projectNBAGame({ snapshot: postseason, predictionAt: availabilityTime })).toMatchObject({ status: 'UNSUPPORTED_PHASE', means: null });
  });

  it('verifies both official reports, exact supporting spans, dated identities and all ten available confirmed starters', () => {
    const { snapshot, intelligence, rawInput } = availabilityFixture();
    expect(snapshot.asOf).toBe(availabilityTime);
    expect(intelligence.cutoff).toBe(new Date(availabilityTime).toISOString());
    expect(rawInput.identities).toHaveLength(10);
    expect(intelligence.claims).toHaveLength(12);
    for (const record of intelligence.claims) {
      expect(record).toMatchObject({ verification: 'OFFICIAL', state: 'CURRENT', reasons: [] });
      expect(supportedClaim(record.claim, record.document)).toBe(true);
      for (const time of [record.document.publishedAt, record.document.firstSeenAt, record.document.fetchedAt,
        record.claim.reportedAt, record.claim.reviewedAt].filter(value => value != null)) {
        expect(Date.parse(time!)).toBeLessThanOrEqual(Date.parse(availabilityTime));
      }
    }
    const result = assessNBAGameAvailability(snapshot, intelligence);
    expect(result).toMatchObject({ injuriesVerified: true, startingLineupsVerified: true, conflictsResolved: true,
      impactReviewResolved: true, numericAdjustmentsApplied: false, blockers: [], phase: { verified: true },
      expiresAt: '2026-01-21T20:40:00.000Z' });
    expect(result.teams.map(team => team.confirmedStarterIds)).toEqual(starterIds);
    expect(result.teams.map(team => team.report)).toEqual(['VERIFIED', 'VERIFIED']);
    expect(result.teams.flatMap(team => team.players)).toHaveLength(10);
    expect(result.teams.flatMap(team => team.players).every(player => player.status === 'AVAILABLE' && player.starter === 'CONFIRMED')).toBe(true);
    for (const playerId of [101, 201]) expect(result.teams.flatMap(team => team.players).find(player => player.playerId === playerId))
      .toMatchObject({ observedGames: 10, recentMinutes: expect.any(Number), status: 'AVAILABLE' });
  });

  it.each(['healthy', 'projected', 'questionable', 'stale', 'missing', 'restriction', 'meaningfulOUT'] as const)
    ('keeps numeric projection, scenarios and quoted EV unchanged for %s evidence', scenario => {
      const fixture = availabilityFixture(scenario);
      const baseline = projectNBAGame(historicalFixture());
      const actual = projectNBAGame({ snapshot: fixture.snapshot, predictionAt: availabilityTime, intelligence: fixture.intelligence });
      expect(actual.means).toEqual(baseline.means);
      expect(actual.scenarios).toEqual(baseline.scenarios);
      expect(actual.profiles).toEqual(baseline.profiles);
      expect(assessGameMarket(actual, quote(), binding)).toEqual(assessGameMarket(baseline, quote(), binding));
      expect(assessNBAGameAvailability(fixture.snapshot, fixture.intelligence).numericAdjustmentsApplied).toBe(false);
    });

  it('never promotes projected team announcements into confirmed lineups', () => {
    const fixture = availabilityFixture('projected');
    expect(fixture.intelligence.claims.filter(record => record.claim.topic === 'LINEUP').every(record => record.verification === 'SPECULATION')).toBe(true);
    const result = assessNBAGameAvailability(fixture.snapshot, fixture.intelligence);
    expect(result.injuriesVerified).toBe(true);
    expect(result.startingLineupsVerified).toBe(false);
    expect(result.impactReviewResolved).toBe(false);
    expect(result.teams.map(team => team.lineup)).toEqual(['PROJECTED', 'PROJECTED']);
    expect(result.teams.map(team => team.projectedStarterIds)).toEqual(starterIds);
    expect(result.teams.flatMap(team => team.confirmedStarterIds)).toEqual([]);
  });

  it.each([
    ['questionable', /player 101: QUESTIONABLE/],
    ['restriction', /player 101: restriction\/rotation change 20_MINUTES/],
    ['meaningfulOUT', /player 101: meaningful\/unknown-impact absence/],
    ['stale', /official target-game injury report stale/],
    ['missing', /Team 2: official target-game injury report missing/],
  ] as const)('blocks %s evidence through the real pipeline', async (scenario, blocker) => {
    const fixture = availabilityFixture(scenario);
    const result = await researchNBAGameLines([availabilityGame()], [availabilityEvent()], availabilityDependencies(fixture));
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]).toMatchObject({ pickTier: 'PASS', availabilityVerified: false,
      availability: { impactReviewResolved: false, numericAdjustmentsApplied: false } });
    expect(result.modeledGames[0].availability?.blockers.join(' ')).toMatch(blocker);
    expect(result.modeledGames[0].reason).toMatch(blocker);
  });

  it('rejects fresh-at-cutoff evidence when lineups expire at use time even with a fresh price', async () => {
    const fixture = availabilityFixture();
    const result = await researchNBAGameLines([availabilityGame()], [availabilityEvent()], availabilityDependencies(fixture));
    const record = result.recommendations[0];
    expect(record.pickTier, JSON.stringify(record.tierRequirementsFailed)).toBe('EDGE');
    const useTime = new Date('2026-01-21T20:40:00Z');
    const assessment = assessNBAGameAvailability(fixture.snapshot, fixture.intelligence, useTime.toISOString());
    expect(assessment.startingLineupsVerified).toBe(true);
    const expired = classifyGameRecommendation({ ...record, quote: { ...record.quote,
      updatedAt: '2026-01-21T20:30:00Z', observedAt: '2026-01-21T20:31:00Z' } }, useTime);
    expect(expired.pickTier).toBe('PASS');
    expect(expired.tierRequirementsFailed).toContain('Availability evidence expired at use time.');
    expect(assessNBAGameAvailability(fixture.snapshot, fixture.intelligence, '2026-01-21T20:40:00.001Z').startingLineupsVerified).toBe(false);
  });

  it.each(['season', 'phase'] as const)('blocks absent %s evidence without date-based inference', field => {
    const fixture = availabilityFixture();
    if (field === 'season') fixture.snapshot.target.seasonId = null;
    else fixture.snapshot.target.phase = 'UNKNOWN';
    const result = assessNBAGameAvailability(fixture.snapshot, fixture.intelligence);
    expect(result.phase.verified).toBe(false);
    expect(result.impactReviewResolved).toBe(false);
    expect(result.blockers.join(' ')).toContain('Verified target season/phase evidence is missing');
  });

  it('rejects a report first observed after cutoff through Agent #2 verification', () => {
    const fixture = availabilityFixture();
    fixture.rawInput.documents[0].firstSeenAt = '2026-01-21T18:00:01Z';
    fixture.rawInput.documents[0].fetchedAt = '2026-01-21T18:00:01Z';
    const intelligence = buildNBAIntelligence(fixture.rawInput);
    expect(intelligence.claims.filter(record => record.claim.topic === 'INJURY').every(record => record.state === 'AFTER_CUTOFF')).toBe(true);
    const result = assessNBAGameAvailability(fixture.snapshot, intelligence);
    expect(result.injuriesVerified).toBe(false);
    expect(result.impactReviewResolved).toBe(false);
  });

  it.each(['report', 'lineup'] as const)('independently rejects an aged %s at prediction cutoff despite Agent #2 CURRENT state', kind => {
    const fixture = availabilityFixture();
    const topic = kind === 'report' ? 'INJURY' : 'LINEUP';
    const staleTime = kind === 'report' ? '2026-01-21T11:59:59Z' : '2026-01-21T14:59:59Z';
    for (const claim of fixture.rawInput.claims.filter(claim => claim.topic === topic)) {
      claim.statementAt = staleTime;
      claim.reportedAt = staleTime;
    }
    const intelligence = buildNBAIntelligence(fixture.rawInput);
    expect(intelligence.claims.filter(record => record.claim.topic === topic).every(record => record.state === 'CURRENT')).toBe(true);
    const result = assessNBAGameAvailability(fixture.snapshot, intelligence);
    expect(result.impactReviewResolved).toBe(false);
    expect(kind === 'report' ? result.injuriesVerified : result.startingLineupsVerified).toBe(false);
    expect(kind === 'report' ? result.startingLineupsVerified : result.injuriesVerified).toBe(true);
  });

  it('does not treat report omission as AVAILABLE for a confirmed key-workload starter', () => {
    const fixture = availabilityFixture();
    fixture.rawInput.claims = fixture.rawInput.claims.filter(claim => !(claim.topic === 'INJURY' && claim.playerIds.includes(101)));
    const result = assessNBAGameAvailability(fixture.snapshot, buildNBAIntelligence(fixture.rawInput));
    expect(result.injuriesVerified).toBe(true);
    expect(result.startingLineupsVerified).toBe(true);
    expect(result.impactReviewResolved).toBe(false);
    expect(result.teams[0].players.find(player => player.playerId === 101)).toMatchObject({
      status: 'NOT_REPORTED', starter: 'CONFIRMED', observedGames: 10, recentMinutes: 30,
    });
    expect(result.blockers).toContain('Team 1, player 101: key rotation availability is not explicitly verified. Report omission is not AVAILABLE.');
  });

  it.each(['absent', 'wrong-game', 'wrong-tipoff'] as const)('rejects %s intelligence without inferring reports or starters', variant => {
    const fixture = availabilityFixture();
    if (variant === 'wrong-game') fixture.rawInput.target.gameId = 'another-game';
    if (variant === 'wrong-tipoff') fixture.rawInput.target.startsAt = '2026-01-22T23:00:00Z';
    const intelligence = variant === 'absent' ? null : buildNBAIntelligence(fixture.rawInput);
    const result = assessNBAGameAvailability(fixture.snapshot, intelligence);
    expect(result).toMatchObject({ intelligenceSnapshotId: null, injuriesVerified: false,
      startingLineupsVerified: false, impactReviewResolved: false });
    expect(result.teams.map(team => team.report)).toEqual(['MISSING', 'MISSING']);
    expect(result.blockers).toContain('No cutoff-safe, exact-game Agent #2 intelligence snapshot.');
  });
});