import { afterEach, describe, expect, it, vi } from 'vitest';
import { espnSiteFetch } from './client';
import { buildNFLPlayerIntelligence, getNFLNewsSnapshot, parseNFLNewsResponse } from './intelligence';

vi.mock('./client', () => ({ espnSiteFetch: vi.fn() }));

const now = new Date('2026-10-05T16:00:00Z');

afterEach(() => vi.clearAllMocks());

describe('free ESPN NFL intelligence source', () => {
  it('keeps recent categorized reporting and removes stale, premium, fantasy and media items', () => {
    const snapshot = parseNFLNewsResponse({ articles: [
      { id: 1, type: 'HeadlineNews', headline: 'Player returns to practice', description: 'Full practice today.', published: '2026-10-05T12:00:00Z', byline: 'Beat Reporter', categories: [{ type: 'athlete', athleteId: 9, description: 'Player One' }, { type: 'team', teamId: 2, description: 'Team' }] },
      { id: 2, type: 'Story', headline: 'Old player report', published: '2026-09-20T12:00:00Z', categories: [{ type: 'athlete', athleteId: 9 }] },
      { id: 3, type: 'Story', headline: 'Premium player report', published: '2026-10-05T12:00:00Z', premium: true, categories: [{ type: 'athlete', athleteId: 9 }] },
      { id: 4, type: 'Story', headline: 'Fantasy pickup', published: '2026-10-05T12:00:00Z', categories: [{ type: 'topic', description: 'Fantasy NFL' }, { type: 'athlete', athleteId: 9 }] },
      { id: 5, type: 'Media', headline: 'Studio clip', published: '2026-10-05T12:00:00Z', categories: [{ type: 'athlete', athleteId: 9 }] },
      { id: 6, type: 'Story', headline: 'Other athlete', published: '2026-10-05T12:00:00Z', categories: [{ type: 'athlete', athleteId: 10 }] },
    ] }, now);
    expect(snapshot.status).toBe('AVAILABLE');
    expect(snapshot.articles.map((article) => article.id)).toEqual(['1', '6']);
  });

  it('normalizes exact-player news while keeping coach speak uncertain and numbers unadjusted', () => {
    const snapshot = parseNFLNewsResponse({ articles: [{ id: 1, type: 'Story', headline: 'Coach says he wants to get Player One more targets',
      description: 'The coach said the receiver could see more chances.', byline: 'Reporter', published: '2026-10-05T12:00:00Z',
      links: { web: { href: 'https://espn.example/story' } }, categories: [{ type: 'athlete', athleteId: 9, description: 'Player One' }] }] }, now);
    const items = buildNFLPlayerIntelligence({ snapshot, playerId: 9, player: 'Player One', teamId: 2, team: 'Team', market: 'player_receptions', retrievedAt: now.toISOString() });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: 'ESPN · Reporter', sourceType: 'NATIONAL', publishedAt: '2026-10-05T12:00:00Z',
      affectedPlayer: 'Player One', affectedMarkets: ['player_receptions'], reliability: 'COACH_SPEAK_UNCERTAIN', direction: 'POSITIVE', confidence: null });
    expect(items[0].marketImpact).toContain('no numeric projection adjustment');
  });

  it('treats an explicit recent workload limitation as negative high-actionability evidence', () => {
    const snapshot = parseNFLNewsResponse({ articles: [{ id: 2, type: 'HeadlineNews', headline: 'Player workload will be limited Sunday',
      description: 'Team expects to restrict the player.', published: '2026-10-05T12:00:00Z', categories: [{ type: 'athlete', athleteId: 9, description: 'Player One' }] }] }, now);
    const [item] = buildNFLPlayerIntelligence({ snapshot, playerId: 9, player: 'Player One', teamId: 2, team: 'Team', market: 'player_receptions' });
    expect(item).toMatchObject({ direction: 'NEGATIVE', actionability: 'HIGH', reliability: 'STRONG_SIGNAL' });
  });

  it('matches team-tagged news but never lets an untagged article affect a candidate', () => {
    const snapshot = parseNFLNewsResponse({ articles: [
      { id: 1, type: 'Preview', headline: 'Team roster context', published: '2026-10-05T12:00:00Z', categories: [{ type: 'team', teamId: 2, description: 'Team' }] },
      { id: 2, type: 'Story', headline: 'Untied player item', published: '2026-10-05T12:00:00Z', categories: [{ type: 'team', teamId: 3 }] },
    ] }, now);
    const items = buildNFLPlayerIntelligence({ snapshot, playerId: 9, player: 'Player One', teamId: 2, team: 'Team', market: 'player_pass_yds' });
    expect(items).toHaveLength(1);
    expect(items[0].affectedPlayer).toBeNull();
    expect(items[0].affectedTeam).toBe('Team');
    expect(items[0].direction).toBe('NEUTRAL');
  });

  it('fetches the structured ESPN league feed through the normalized cache adapter', async () => {
    vi.mocked(espnSiteFetch).mockResolvedValue({ articles: [] });
    const snapshot = await getNFLNewsSnapshot(now);
    expect(espnSiteFetch).toHaveBeenCalledWith('news', { limit: '100' }, 0);
    expect(snapshot.status).toBe('AVAILABLE');
  });
});