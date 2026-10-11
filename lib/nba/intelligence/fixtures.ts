import { createReviewedClaim } from './claims';
import { createRevision } from './documents';
import type { IntelligenceInput, IntelligenceSource, TargetEvent } from './types';

export const target: TargetEvent = { gameId: '100', homeTeamId: 1, awayTeamId: 2, startsAt: '2026-10-07T23:00:00Z', basketballDate: '2026-10-07', matchupAliases: ['AWY@HME'] };
export const source: IntelligenceSource = { id: 'official-fixture', name: 'Official fixture team', category: 'OFFICIAL_TEAM', origins: ['https://team.example'], pathPrefixes: ['/news/'], teamIds: [1], authors: [], access: { mode: 'PERMISSION_REQUIRED', minIntervalMs: 1000, notes: 'Fixture' } };
export function fixtureInput(): IntelligenceInput {
  const document = createRevision({ sourceId: source.id, url: 'https://team.example/news/lineup', bytes: 'Starting five: Player 1, Player 2, Player 3, Player 4, Player 5.', mediaType: 'REVIEWED_TEXT', fetchedAt: '2026-10-07T21:00:00Z', parsed: { title: 'Announcement', author: null, text: 'Starting five: Player 1, Player 2, Player 3, Player 4, Player 5.', publishedAt: '2026-10-07T20:00:00Z', updatedAt: null, originalUrls: [], issues: [] } });
  const claim = createReviewedClaim(document, { topic: 'LINEUP', playerIds: [1, 2, 3, 4, 5], teamId: 1, gameId: '100', appliesFrom: '2026-10-07T00:00:00Z', appliesUntil: '2026-10-08T06:00:00Z', statementAt: '2026-10-07T20:00:00Z', reportedAt: document.publishedAt, value: 'STARTING_FIVE', qualifier: 'EXPLICIT', lineupLevel: 'OFFICIALLY_CONFIRMED', speaker: null, originalClaimId: null, originalUrls: [], reviewedBy: 'fixture-editor', reviewedAt: '2026-10-07T21:00:00Z', correctionOf: null, excerpt: document.text });
  return { target, asOf: '2026-10-07T22:00:00Z', documents: [document], claims: [claim], sources: [source], identities: [1, 2, 3, 4, 5, 6].map(id => ({ espnId: id, nbaId: id + 1000, name: `Player ${id}`, aliases: [], teamId: 1, validFrom: '2026-01-01T00:00:00Z', validTo: null })) };
}