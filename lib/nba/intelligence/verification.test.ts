import { describe, expect, it } from 'vitest';
import { verifyClaims } from './verification';
import { buildLineups } from './lineups';
import { fixtureInput, source, target } from './fixtures';
import { parseOfficialItems, officialReportRevision, officialReportClaims } from './adapters/officialInjuries';
import { INTELLIGENCE_SOURCES } from './sources';

describe('game-scoped verification and lineups', () => {
  it('requires explicit official complete lineups and preserves partial starters', () => {
    const input = fixtureInput();
    const verified = verifyClaims(input, input.asOf);
    expect(verified[0]).toMatchObject({ verification: 'OFFICIAL', state: 'CURRENT' });
    expect(buildLineups(target, verified)[0].level).toBe('OFFICIALLY_CONFIRMED');
    input.claims[0] = { ...input.claims[0], playerIds: [1] };
    expect(buildLineups(target, verifyClaims(input, input.asOf))[0].level).toBe('UNKNOWN');
  });
  it('rejects unsupported quotes, future edits, old statements and unknown identity', () => {
    for (const change of [{ evidence: { ...fixtureInput().claims[0].evidence, excerpt: 'Invented' } }, { playerIds: [999] }, { gameId: 'other' }]) {
      const input = fixtureInput(); input.claims[0] = { ...input.claims[0], ...change };
      expect(verifyClaims(input, input.asOf)[0].state).toBe('UNKNOWN');
    }
    const late = fixtureInput(); late.documents[0] = { ...late.documents[0], updatedAt: '2026-10-08T12:00:00Z' };
    expect(verifyClaims(late, late.asOf)[0].state).toBe('AFTER_CUTOFF');
    const old = fixtureInput(); old.claims[0] = { ...old.claims[0], statementAt: '2026-10-01T20:00:00Z' };
    expect(verifyClaims(old, old.asOf)[0].state).toBe('STALE');
    expect(buildLineups(target, verifyClaims(old, old.asOf))[0]).toMatchObject({ level: 'UNKNOWN', state: 'STALE', playerIds: [] });
  });
  it('does not treat editorial authority or a coach intention as final confirmation', () => {
    const input = fixtureInput(); input.sources = [{ ...source, category: 'TEAM_EDITORIAL', authors: [{ name: 'Writer', profileUrl: 'https://team.example/writer', verifiedAt: '2026-10-01T00:00:00Z' }] }];
    input.documents[0] = { ...input.documents[0], author: 'Writer' };
    expect(verifyClaims(input, input.asOf)[0].verification).toBe('UNVERIFIED');
    const projected = fixtureInput(); projected.claims[0] = { ...projected.claims[0], qualifier: 'PROJECTED', lineupLevel: 'PROJECTED' };
    expect(buildLineups(target, verifyClaims(projected, projected.asOf))[0].level).toBe('PROJECTED');
  });
  it('does not count syndicated copies as independent corroboration', () => {
    const input = fixtureInput();
    input.sources = [{ ...source, category: 'VERIFIED_REPORTER', authors: [{ name: 'Writer', profileUrl: 'https://team.example/author', verifiedAt: '2026-10-01T00:00:00Z' }] }, { ...source, id: 'copy', category: 'VERIFIED_REPORTER', origins: ['https://copy.example'], authors: [{ name: 'Writer', profileUrl: 'https://copy.example/author', verifiedAt: '2026-10-01T00:00:00Z' }] }];
    input.documents[0] = { ...input.documents[0], author: 'Writer' };
    input.claims[0] = { ...input.claims[0], lineupLevel: 'REPORTED', independence: 'DIRECT' };
    input.documents.push({ ...input.documents[0], revisionId: 'copy-revision', sourceId: 'copy', url: 'https://copy.example/news/report' });
    input.claims.push({ ...input.claims[0], id: 'copy-claim', documentRevisionId: 'copy-revision', sourceId: 'copy', originalClaimId: input.claims[0].id, originalUrls: [input.documents[0].url], independence: 'CITED' });
    expect(verifyClaims(input, input.asOf).every(record => record.verification === 'ATTRIBUTED_REPORT')).toBe(true);
  });
  it('preserves partial starters and flags OUT or questionable players in complete lineups', () => {
    const input = fixtureInput();
    input.claims.push({ ...input.claims[0], id: 'injury', topic: 'INJURY', playerIds: [1], lineupLevel: null, value: 'QUESTIONABLE' });
    expect(buildLineups(target, verifyClaims(input, input.asOf))[0].unresolvedPlayerIds).toEqual([1]);
    input.claims[1] = { ...input.claims[1], value: 'OUT' };
    expect(buildLineups(target, verifyClaims(input, input.asOf))[0].state).toBe('CONFLICTED');
    const partial = fixtureInput(); partial.claims[0] = { ...partial.claims[0], topic: 'STARTING_ROLE', playerIds: [1], lineupLevel: null, value: 'STARTER' };
    expect(buildLineups(target, verifyClaims(partial, partial.asOf))[0]).toMatchObject({ level: 'UNKNOWN', partialStarterIds: [1] });
  });
  it('supersedes a prior official injury edition without letting a secondary newest report win', () => {
    const input = fixtureInput();
    const headings = ['Game Date', 'Game Time', 'Matchup', 'Team', 'Player Name', 'Current Status', 'Reason'].map((str, index) => ({ str, x: index * 100, y: 750, width: 40, height: 10 }));
    const report = (hour: number, status: string) => parseOfficialItems([[{ str: `Injury Report: 10/07/26 0${hour}:00 PM`, x: 0, y: 790, width: 40, height: 10 }, ...headings,
      ...['10/07/2026', '07:00(ET)', 'AWY@HME', 'Fixture Home', 'Player 1', status, 'Ankle'].map((str, index) => ({ str, x: index * 100, y: 700, width: 40, height: 10 }))]]);
    const oldReport = report(3, 'Questionable'); const newerReport = report(4, 'Out');
    const oldDocument = officialReportRevision(oldReport, 'old', 'https://ak-static.cms.nba.com/referee/injury/Injury-Report_old.pdf', '2026-10-07T20:00:00Z');
    const newDocument = officialReportRevision(newerReport, 'new', 'https://ak-static.cms.nba.com/referee/injury/Injury-Report_new.pdf', '2026-10-07T21:00:00Z');
    const teams = [{ teamId: 1, names: ['Fixture Home'] }];
    const oldClaims = officialReportClaims(oldReport, oldDocument, target, teams, input.identities).claims;
    const newClaims = officialReportClaims(newerReport, newDocument, target, teams, input.identities).claims;
    const verified = verifyClaims({ ...input, sources: [...INTELLIGENCE_SOURCES], documents: [oldDocument, newDocument], claims: [...oldClaims, ...newClaims] }, input.asOf);
    expect(verified.find(record => record.claim.value === 'QUESTIONABLE')?.state).toBe('SUPERSEDED');
    expect(verified.find(record => record.claim.value === 'OUT')).toMatchObject({ state: 'CURRENT', verification: 'OFFICIAL' });
  });
  it('requires explicit reviewed independent publishers before corroboration', () => {
    const input = fixtureInput();
    const authors = [{ name: 'Writer', profileUrl: 'https://team.example/author', verifiedAt: '2026-10-01T00:00:00Z' }];
    input.sources = [{ ...source, category: 'VERIFIED_REPORTER', authors }, { ...source, id: 'independent', category: 'VERIFIED_REPORTER', origins: ['https://independent.example'], authors }];
    input.documents[0] = { ...input.documents[0], author: 'Writer' };
    input.documents.push({ ...input.documents[0], revisionId: 'other-document', sourceId: 'independent', url: 'https://independent.example/news/report' });
    input.claims[0] = { ...input.claims[0], lineupLevel: 'REPORTED', independence: 'DIRECT' };
    input.claims.push({ ...input.claims[0], id: 'other-claim', documentRevisionId: 'other-document', sourceId: 'independent' });
    expect(verifyClaims(input, input.asOf).every(record => record.verification === 'CORROBORATED')).toBe(true);
    input.claims = input.claims.map(claim => ({ ...claim, independence: 'UNKNOWN' }));
    expect(verifyClaims(input, input.asOf).every(record => record.verification === 'ATTRIBUTED_REPORT')).toBe(true);
  });
});