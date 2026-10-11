import { officialReportClaims, officialReportRevision, type ParsedOfficialReport } from '../../intelligence/adapters/officialInjuries';
import { createReviewedClaim } from '../../intelligence/claims';
import { createRevision } from '../../intelligence/documents';
import { buildNBAIntelligence } from '../../intelligence/engine';
import { INTELLIGENCE_SOURCES } from '../../intelligence/sources';
import type { IntelligenceInput, IntelligenceSource } from '../../intelligence/types';
import type { NBAGame } from '../../types';
import type { OddsEvent } from '../../../odds/types';
import { historicalFixture, quote } from './fixtures';
import type { researchNBAGameLines } from './pipeline';
import type { GameQuote } from './types';

export type AvailabilityScenario = 'healthy' | 'projected' | 'questionable' | 'stale' | 'missing' | 'restriction' | 'meaningfulOUT';
export const availabilityTime = '2026-01-21T18:00:00Z';
export const starterIds = [[101, 102, 103, 104, 105], [201, 202, 203, 204, 205]];

export function availabilityFixture(scenario: AvailabilityScenario = 'healthy') {
  const { snapshot } = historicalFixture();
  for (const game of [...snapshot.games, snapshot.target]) {
    const observations = game.teams.flatMap(team => team.players);
    for (const [index, team] of game.teams.entries()) {
      const playerId = starterIds[index][0];
      team.players = [{ ...observations[index], playerId, name: `Fixture Player ${playerId}` }];
    }
  }
  const target = { gameId: snapshot.target.gameId, homeTeamId: snapshot.target.homeTeamId,
    awayTeamId: snapshot.target.awayTeamId, startsAt: snapshot.target.startsAt,
    basketballDate: '2026-01-21', matchupAliases: ['AWY@HOM'] };
  const identities = starterIds.flatMap((players, index) => players.map(playerId => ({
    espnId: playerId, nbaId: playerId + 10000, name: `Fixture Player ${playerId}`, aliases: [],
    teamId: index + 1, validFrom: '2025-10-01T00:00:00Z', validTo: '2026-07-01T00:00:00Z',
  })));
  const reportTime = scenario === 'stale' ? '2026-01-21T11:59:00Z' : '2026-01-21T17:30:00Z';
  const rows = identities.filter(identity => scenario !== 'missing' || identity.teamId === 1).map(identity => {
    const status = identity.espnId === 101 && scenario === 'questionable' ? 'QUESTIONABLE'
      : identity.espnId === 101 && scenario === 'meaningfulOUT' ? 'OUT' : 'AVAILABLE';
    const teamName = identity.teamId === 1 ? 'Home' : 'Away';
    const reason = status === 'AVAILABLE' ? 'Cleared to play' : 'Left ankle injury';
    return { gameDate: target.basketballDate, matchup: 'AWY@HOM', teamName,
      playerName: identity.name, status, reason, page: 1,
      excerpt: `01/21/2026 06:00 PM AWY@HOM ${teamName} ${identity.name} ${status} ${reason}` };
  });
  const parsed: ParsedOfficialReport = { reportedAt: reportTime, rows,
    text: [`Fixture NBA injury report ${reportTime}`, ...rows.map(row => row.excerpt)].join('\n'), issues: [] };
  const report = officialReportRevision(parsed, parsed.text,
    'https://ak-static.cms.nba.com/referee/injury/Injury-Report_2026-01-21_fixture.pdf', '2026-01-21T17:35:00Z');
  const official = officialReportClaims(parsed, report, target,
    [{ teamId: 1, names: ['Home'] }, { teamId: 2, names: ['Away'] }], identities);
  const input: IntelligenceInput = { target, asOf: availabilityTime, documents: [report], claims: [...official.claims],
    identities, sources: [...INTELLIGENCE_SOURCES], missing: official.missing };
  for (const [index, players] of starterIds.entries()) {
    const teamId = index + 1;
    const source: IntelligenceSource = { id: `fixture-official-team-${teamId}`, name: `Fixture Team ${teamId} Announcements`,
      category: 'OFFICIAL_TEAM', origins: [`https://team-${teamId}.example`], pathPrefixes: ['/official/'], teamIds: [teamId],
      authors: [], access: { mode: 'MANUAL_ONLY', minIntervalMs: 1000, notes: 'Explicit synthetic official team fixture source.' } };
    input.sources!.push(source);
    const projected = scenario === 'projected';
    const excerpt = `${projected ? 'Projected' : 'Confirmed'} starting five for AWY@HOM on January 21, 2026: ${players.map(playerId => `Fixture Player ${playerId}`).join(', ')}.`;
    const restriction = 'Fixture Player 101 is limited to 20 minutes for AWY@HOM on January 21, 2026.';
    const text = scenario === 'restriction' && teamId === 1 ? `${excerpt}\n${restriction}` : excerpt;
    const lineupTime = scenario === 'stale' ? '2026-01-21T14:59:00Z' : '2026-01-21T17:40:00Z';
    const document = createRevision({ sourceId: source.id, url: `${source.origins[0]}/official/starting-five`,
      bytes: text, mediaType: 'REVIEWED_TEXT', fetchedAt: '2026-01-21T17:45:00Z',
      parsed: { title: 'Fixture starting five', author: null, text, publishedAt: lineupTime, updatedAt: null, originalUrls: [], issues: [] } });
    input.documents.push(document);
    const common = { teamId, gameId: target.gameId, appliesFrom: '2026-01-21T00:00:00Z', appliesUntil: '2026-01-22T11:00:00Z',
      statementAt: lineupTime, reportedAt: lineupTime, speaker: null, originalClaimId: null, originalUrls: [],
      reviewedBy: 'availability-fixture-reviewer', reviewedAt: '2026-01-21T17:45:00Z', correctionOf: null };
    input.claims.push(createReviewedClaim(document, { ...common, topic: 'LINEUP', playerIds: players,
      value: 'STARTING_FIVE', qualifier: projected ? 'PROJECTED' : 'EXPLICIT',
      lineupLevel: projected ? 'PROJECTED' : 'OFFICIALLY_CONFIRMED', excerpt }));
    if (scenario === 'restriction' && teamId === 1) input.claims.push(createReviewedClaim(document, {
      ...common, topic: 'MINUTES_RESTRICTION', playerIds: [101], value: '20_MINUTES', qualifier: 'EXPLICIT',
      lineupLevel: null, excerpt: restriction,
    }));
  }
  const rawInput = structuredClone(input);
  return { snapshot, intelligence: buildNBAIntelligence(rawInput), rawInput };
}

export function availabilityGame(): NBAGame {
  return { id: 'target', gameTime: '2026-01-21T23:00:00Z', completed: false, homeScore: null, awayScore: null,
    homeTeam: { id: 1, name: 'Home', displayName: 'Home', abbreviation: 'HOM', logoUrl: null },
    awayTeam: { id: 2, name: 'Away', displayName: 'Away', abbreviation: 'AWY', logoUrl: null } };
}

export function availabilityEvent(): OddsEvent {
  return { id: 'odds-1', commenceTime: '2026-01-21T23:00:00Z', homeTeam: 'Home', awayTeam: 'Away' };
}

export function availabilityDependencies(fixture: ReturnType<typeof availabilityFixture>,
  actualQuote: GameQuote = quote({ market: 'MONEYLINE', selection: 'HOME', team: 'HOME', line: null })):
  NonNullable<Parameters<typeof researchNBAGameLines>[2]> {
  return { loadSnapshot: async () => fixture.snapshot, loadIntelligence: async () => fixture.intelligence,
    loadQuotes: async () => ({ status: 'AVAILABLE', quotes: [actualQuote], reason: null }) };
}