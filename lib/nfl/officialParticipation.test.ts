import { describe, expect, it } from 'vitest';
import { loadOfficialNFLParticipation, parseOfficialNFLParticipation } from './officialParticipation';
import { evaluateNFLParticipation, type NFLParticipationSnapshot } from './participation';
import type { NFLGame } from './types';

const now = new Date('2026-10-19T23:55:00Z');
const game = { id: '401873008', gameTime: '2026-10-20T00:15:00Z', homeTeam: { id: 25, name: '49ers', displayName: 'San Francisco 49ers' },
  awayTeam: { id: 28, name: 'Commanders', displayName: 'Washington Commanders' } } as NFLGame;
const url = 'https://www.49ers.com/news/official-inactives';
const players = [{ id: '10', fullName: 'Mike Evans', status: { name: 'Active' }, injuries: [] }, { id: '11', fullName: 'Deebo Samuel Sr.' }];
const article = { '@type': 'NewsArticle', url, datePublished: '2026-10-19T22:44:25Z',
  articleBody: "San Francisco 49ers vs. Washington Commanders.\nMike Evans was questionable but is active for Monday's game.\nHere are the 49ers inactives:\nWR Deebo Samuel Sr." };
const html = (value = article) => `<script type="application/ld+json">${JSON.stringify(value)}</script>`;

describe('official NFL game-day participation', () => {
  it.skipIf(process.env.NFL_VERIFY_FREE_OFFICIAL_REPORTS !== 'true')('verifies the published reports using only free official and ESPN sources at the purchased-quote cutoff', async () => {
    const results = [];
    for (const teamId of [25, 28]) {
      const response = await fetch(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/roster`);
      expect(response.ok).toBe(true);
      const roster = await response.json();
      const athletes = roster.athletes.flatMap((group: { items?: typeof players }) => group.items ?? []);
      const evidence = await loadOfficialNFLParticipation(game, { teamId, athletes }, now);
      results.push({ teamId, active: evidence.filter(entry => entry.designation === 'CONFIRMED_AVAILABLE').map(entry => entry.playerId),
        inactive: evidence.filter(entry => entry.designation === 'INACTIVE').map(entry => entry.playerId) });
      expect(evidence.length).toBeGreaterThan(0);
    }
    expect(results[0].active.length).toBeGreaterThan(0);
    console.info('Official evidence at purchased-quote cutoff:', JSON.stringify(results));
  }, 45000);
  it('uses explicit active/inactive statements, never report omission, wrong dates, teams or hosts', () => {
    expect(parseOfficialNFLParticipation(html(), url, game, 25, players, now).map(entry => entry.designation)).toEqual(['CONFIRMED_AVAILABLE', 'INACTIVE']);
    expect(parseOfficialNFLParticipation(html(), url, game, 28, players, now)).toEqual([]);
    expect(parseOfficialNFLParticipation(html({ ...article, datePublished: '2026-10-18T22:00:00Z' }), url, game, 25, players, now)).toEqual([]);
    expect(parseOfficialNFLParticipation(html(), url, game, 25, [{ id: '12', fullName: 'Brock Purdy' }], now)).toEqual([]);
  });
  it('resolves game-day participation but never clears current OUT or newer restrictions', () => {
    const snapshot: NFLParticipationSnapshot = { gameId: game.id, kickoff: game.gameTime, fetchedAt: now.toISOString(), expiresAt: now.getTime() + 300000,
      gameVerified: true, teamIds: [25, 28], failures: [], rosters: [{ teamId: 25, timestamp: now.toISOString(), complete: true, athletes: players }],
      depthCharts: [], gameInjuries: [{ teamId: 25, complete: true, reports: [] }], officialParticipation: parseOfficialNFLParticipation(html(), url, game, 25, players, now) };
    const evaluate = () => evaluateNFLParticipation({ playerId: 10, teamId: 25, position: 'WR', snapshot, injuries: null, now });
    expect(evaluate().designation).toBe('CONFIRMED_AVAILABLE');
    snapshot.rosters[0].athletes[0].status = { name: 'Out' };
    expect(evaluate().designation).toBe('OUT');
    snapshot.rosters[0].athletes[0].status = { name: 'Active' };
    snapshot.gameInjuries[0].reports = [{ athlete: { id: '10' }, status: 'Questionable', date: now.toISOString() }];
    expect(evaluate().designation).toBe('QUESTIONABLE');
  });
});