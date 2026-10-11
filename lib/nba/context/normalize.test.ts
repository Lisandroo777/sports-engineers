import { describe, expect, it } from 'vitest';
import { normalizeStats, normalizeStatus, officialPhase, parseMinutes, parseShooting, normalizeSummary } from './normalize';
import type { SourceReference } from './types';

const source: SourceReference = { id: 'fixture', provider: 'ESPN', url: 'https://site.api.espn.com/fixture', recordId: null, publishedAt: null, updatedAt: null, fetchedAt: '2026-01-02T18:00:00Z', freshness: 'UNKNOWN' };
describe('independent context normalization', () => {
  it('retains attempts and real zero values, never blank/DNP as zero', () => {
    expect(parseShooting('2-7')).toEqual([2, 7]);
    expect(parseShooting('7-2')).toEqual([null, null]);
    const stats = normalizeStats(['minutes', 'FG', '3PT', 'FT', 'points', 'assists'], ['30:30', '5-12', '2-7', '0-0', '', 'DNP']);
    expect(stats).toMatchObject({ minutes: 30.5, fgm: 5, fga: 12, tpm: 2, tpa: 7, ftm: 0, fta: 0, points: null, assists: null });
    expect(parseMinutes('2:70')).toBeNull();
    expect(parseMinutes('')).toBeNull();
  });
  it('does not infer playoffs from dates or turn probable/day-to-day into active', () => {
    expect(officialPhase({ type: 3 })).toBe('POSTSEASON');
    expect(officialPhase({ year: 2026 })).toBe('UNKNOWN');
    expect(normalizeStatus('Day-To-Day')).toBe('UNKNOWN');
    expect(normalizeStatus('Probable')).toBe('PROBABLE');
    expect(normalizeStatus('Questionable')).toBe('QUESTIONABLE');
    expect(officialPhase(2)).toBe('REGULAR');
    expect(normalizeStats(['points'], ['-2']).points).toBeNull();
  });
  it('needs final-period end timestamps and ignores a reason on a played row', () => {
    const payload = { header: { id: 'game', season: { year: 2026, type: 2 }, competitions: [{ date: '2026-01-01T20:00:00Z', status: { type: { completed: true } }, competitors: [{ homeAway: 'home', team: { id: '1' }, score: '100' }, { homeAway: 'away', team: { id: '2' }, score: '90' }] }] }, boxscore: { players: [{ team: { id: '1' }, statistics: [{ keys: ['minutes', 'points'], athletes: [{ athlete: { id: '10', displayName: 'Player' }, starter: true, didNotPlay: false, reason: "COACH'S DECISION", stats: ['30', '20'] }, { athlete: { id: '11' }, didNotPlay: true, reason: 'INJURY', stats: ['0', '0'] }] }] }] }, plays: [] };
    const game = normalizeSummary(payload, source)!;
    expect(game.completedAt).toBeNull();
    expect(game.teams[0].players[0].dnpReason).toBeNull();
    expect(game.teams[0].players[1].stats.minutes).toBeNull();
    expect(normalizeSummary({ ...payload, plays: [{ id: 'end', sequenceNumber: '1', type: { text: 'End Game' }, period: { number: 4 }, clock: { displayValue: '0:00' }, wallclock: '2026-01-01T22:30:00Z', homeScore: 100, awayScore: 90 }] }, source)?.completedAt).toBe('2026-01-01T22:30:00.000Z');
  });
});