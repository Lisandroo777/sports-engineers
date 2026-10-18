import { describe, expect, it } from 'vitest';
import { isNFLGameResearchPublishable, type NFLResearchCoverageCandidate } from './partialCoverage';
import { finishNFLSlateLedger, type NFLGameLedger, type NFLSlateLedger } from './slateLedger';

const now = Date.parse('2026-10-18T12:00:00Z');
const timestamp = (offset: number) => new Date(now + offset).toISOString();

function slate(researched = 10): NFLSlateLedger {
  return finishNFLSlateLedger({
    sport: 'nfl', date: '2026-10-18', requestedMarkets: ['player_pass_yds', 'player_pass_tds'],
    games: Array.from({ length: 12 }, (_, index): NFLGameLedger => ({
      gameId: `game-${index}`, matchup: 'Away @ Home', kickoff: timestamp(3_600_000),
      eligibility: 'PREGAME', state: index < researched ? 'RESEARCHED' : 'NOT_FETCHED',
      eventId: `event-${index}`, returnedMarkets: ['player_pass_yds'], zeroMarkets: ['player_pass_tds'],
      failedMarkets: [], retrievedAt: timestamp(-1_000), expiresAt: now + 59_000,
      failure: null, propsEvaluated: 1, fromCache: true,
    })),
  });
}

function candidate(index = 0): NFLResearchCoverageCandidate {
  return { gameId: `game-${index}`, eventId: `event-${index}`, marketKey: 'player_pass_yds', retrievedAt: timestamp(-1_000) };
}

describe('offline NFL per-candidate partial coverage', () => {
  it('permits only the ten fully researched games of twelve without mutating coverage', () => {
    const ledger = slate();
    const before = structuredClone(ledger);
    ledger.games.forEach((_, index) => {
      expect(isNFLGameResearchPublishable(ledger, candidate(index), now)).toBe(index < 10);
    });
    expect(ledger).toEqual(before);
    expect(ledger).toMatchObject({ researchedGames: 10, expectedGames: 12, researchComplete: false });
  });

  it('also permits candidates from an entirely complete slate', () => {
    const ledger = slate(12);
    expect(ledger.researchComplete).toBe(true);
    expect(ledger.games.every((_, index) => isNFLGameResearchPublishable(ledger, candidate(index), now))).toBe(true);
  });

  it.each([null, undefined])('fails closed without a ledger (%s)', (ledger) => {
    expect(isNFLGameResearchPublishable(ledger, candidate(), now)).toBe(false);
  });

  it.each<NFLGameLedger['state']>(['NOT_FETCHED', 'SPORTSBOOK_AVAILABLE', 'ZERO_MARKETS', 'FAILED'])('rejects state %s', (state) => {
    const ledger = slate();
    ledger.games[0].state = state;
    expect(isNFLGameResearchPublishable(ledger, candidate(), now)).toBe(false);
  });

  it('rejects an incomplete or failed requested market even if the candidate market returned', () => {
    const ledger = slate();
    ledger.games[0].zeroMarkets = [];
    expect(isNFLGameResearchPublishable(ledger, candidate(), now)).toBe(false);
    ledger.games[0].zeroMarkets = ['player_pass_tds'];
    ledger.games[0].failedMarkets = ['player_pass_tds'];
    expect(isNFLGameResearchPublishable(ledger, candidate(), now)).toBe(false);
    expect(isNFLGameResearchPublishable(ledger, candidate(1), now)).toBe(true);
  });

  it('never creates a player candidate from a zero market or a zero-only game', () => {
    const ledger = slate();
    expect(isNFLGameResearchPublishable(ledger, { ...candidate(), marketKey: 'player_pass_tds' }, now)).toBe(false);
    ledger.games[0].returnedMarkets = [];
    ledger.games[0].zeroMarkets = [...ledger.requestedMarkets];
    expect(isNFLGameResearchPublishable(ledger, candidate(), now)).toBe(false);
  });

  it.each(['unknown', 'player_rush_yds'])('rejects unknown or unrequested market %s even if returned', (marketKey) => {
    const ledger = slate();
    ledger.games[0].returnedMarkets.push('player_rush_yds');
    expect(isNFLGameResearchPublishable(ledger, { ...candidate(), marketKey }, now)).toBe(false);
  });

  it('canonicalizes alternate and alias market keys', () => {
    expect(isNFLGameResearchPublishable(slate(), { ...candidate(), marketKey: 'player_pass_yds_alternate' }, now)).toBe(true);
    const ledger = slate();
    ledger.requestedMarkets = ['player_rush_rec_yds'];
    ledger.games[0].returnedMarkets = ['player_rush_rec_yds'];
    expect(isNFLGameResearchPublishable(ledger, { ...candidate(), marketKey: 'player_rush_reception_yds' }, now)).toBe(true);
  });

  it.each([undefined, null, 'invalid', timestamp(-31 * 60_000), timestamp(60_001)])('rejects stale, future or missing candidate retrieval %s', (retrievedAt) => {
    expect(isNFLGameResearchPublishable(slate(), { ...candidate(), retrievedAt }, now)).toBe(false);
  });

  it.each([null, 'invalid', timestamp(-31 * 60_000), timestamp(60_001)])('rejects stale, future or missing game retrieval %s', (retrievedAt) => {
    const ledger = slate();
    ledger.games[0].retrievedAt = retrievedAt;
    expect(isNFLGameResearchPublishable(ledger, candidate(), now)).toBe(false);
  });

  it.each([
    { kickoffHours: 7, ageMinutes: 10, publishable: true },
    { kickoffHours: 7, ageMinutes: 30, publishable: true },
    { kickoffHours: 7, ageMinutes: 31, publishable: false },
    { kickoffHours: 3, ageMinutes: 10, publishable: true },
    { kickoffHours: 3, ageMinutes: 11, publishable: false },
    { kickoffHours: 1, ageMinutes: 5, publishable: true },
    { kickoffHours: 1, ageMinutes: 6, publishable: false },
  ])('uses sportsbook freshness for row and quote: %j', ({ kickoffHours, ageMinutes, publishable }) => {
    const ledger = slate();
    ledger.games[0].kickoff = timestamp(kickoffHours * 3_600_000);
    const retrievedAt = timestamp(-ageMinutes * 60_000);
    expect(ledger.games[0].fromCache).toBe(true);
    expect(isNFLGameResearchPublishable(ledger, { ...candidate(), retrievedAt }, now)).toBe(publishable);
    ledger.games[0].retrievedAt = retrievedAt;
    expect(isNFLGameResearchPublishable(ledger, candidate(), now)).toBe(publishable);
    expect(isNFLGameResearchPublishable(ledger, { ...candidate(), retrievedAt }, now)).toBe(publishable);
  });

  it.each([1, 60_000])('accepts the sportsbook future allowance of %s ms for row and quote', (offset) => {
    const ledger = slate();
    ledger.games[0].retrievedAt = timestamp(offset);
    expect(isNFLGameResearchPublishable(ledger, { ...candidate(), retrievedAt: timestamp(offset) }, now)).toBe(true);
  });

  it('defaults the clock to Date.now', () => {
    const ledger = slate();
    const liveNow = Date.now();
    ledger.games[0].retrievedAt = new Date(liveNow).toISOString();
    ledger.games[0].kickoff = new Date(liveNow + 3_600_000).toISOString();
    ledger.games[0].expiresAt = liveNow + 60_000;
    expect(isNFLGameResearchPublishable(ledger, { ...candidate(), retrievedAt: ledger.games[0].retrievedAt })).toBe(true);
  });

  it.each([null, NaN, Infinity, now, now - 1])('rejects invalid or expired expiry %s', (expiresAt) => {
    const ledger = slate();
    ledger.games[0].expiresAt = expiresAt;
    expect(isNFLGameResearchPublishable(ledger, candidate(), now)).toBe(false);
  });

  it.each(['invalid', timestamp(0), timestamp(-1)])('rejects invalid or started kickoff %s despite PREGAME', (kickoff) => {
    const ledger = slate();
    ledger.games[0].kickoff = kickoff;
    expect(isNFLGameResearchPublishable(ledger, candidate(), now)).toBe(false);
  });

  it.each<NFLGameLedger['eligibility']>(['STARTED', 'FINAL', 'EXCLUDED'])('rejects eligibility %s', (eligibility) => {
    const ledger = slate();
    ledger.games[0].eligibility = eligibility;
    expect(isNFLGameResearchPublishable(ledger, candidate(), now)).toBe(false);
  });

  it('requires a unique matching game and a nonempty matching event', () => {
    const ledger = slate();
    expect(isNFLGameResearchPublishable(ledger, { ...candidate(), gameId: 'missing' }, now)).toBe(false);
    expect(isNFLGameResearchPublishable(ledger, { ...candidate(), eventId: 'event-1' }, now)).toBe(false);
    expect(isNFLGameResearchPublishable(ledger, { ...candidate(), eventId: '' }, now)).toBe(false);
    ledger.games[0].eventId = '';
    expect(isNFLGameResearchPublishable(ledger, { ...candidate(), eventId: '' }, now)).toBe(false);
    ledger.games[0].eventId = 'event-0';
    ledger.games.push({ ...ledger.games[0] });
    expect(isNFLGameResearchPublishable(ledger, candidate(), now)).toBe(false);
  });

  it.each(['gameId', 'eventId', 'marketKey'] as const)('rejects missing, null or empty candidate %s', (field) => {
    for (const value of [undefined, null, '']) {
      expect(isNFLGameResearchPublishable(slate(), { ...candidate(), [field]: value }, now)).toBe(false);
    }
    const missing = candidate();
    delete missing[field];
    expect(isNFLGameResearchPublishable(slate(), missing, now)).toBe(false);
  });

  it('accepts provider-specific source IDs but rejects a known different slate game', () => {
    for (const sourceGameId of [undefined, null, 'game-0', '401-source-provider']) {
      expect(isNFLGameResearchPublishable(slate(), { ...candidate(), sourceGameId }, now)).toBe(true);
    }
    expect(isNFLGameResearchPublishable(slate(), { ...candidate(), sourceGameId: 'game-1' }, now)).toBe(false);
  });

  it('fails closed for a wrong sport, missing state, provider failure or invalid clock', () => {
    const ledger = slate();
    expect(isNFLGameResearchPublishable({ ...ledger, sport: 'nba' } as unknown as NFLSlateLedger, candidate(), now)).toBe(false);
    const missingState = structuredClone(ledger);
    Reflect.deleteProperty(missingState.games[0], 'state');
    expect(isNFLGameResearchPublishable(missingState, candidate(), now)).toBe(false);
    ledger.games[0].failure = 'MALFORMED_RESPONSE';
    expect(isNFLGameResearchPublishable(ledger, candidate(), now)).toBe(false);
    expect(isNFLGameResearchPublishable(slate(), candidate(), NaN)).toBe(false);
  });
});