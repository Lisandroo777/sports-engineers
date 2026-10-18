import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NFLKickingResearch } from './NFLKickingResearch';
import { getNFLKickingResearch } from '../lib/nfl/kickingResearch';
import type { NFLGameLogEntry } from '../lib/nfl/types';

function log(gameId: string, season: number, stats: NFLGameLogEntry['stats']): NFLGameLogEntry {
  return { gameId, season, date: `${season}-10-17T12:00:00Z`, week: 6, opponent: 'Opponent', opponentAbbreviation: 'OPP', homeAway: 'home', result: 'W', stats };
}

describe('NFL kicking source facts SSR', () => {
  const blockedFetch = vi.fn(() => { throw new Error('Network forbidden in kicking presentation tests'); });
  beforeEach(() => { vi.stubGlobal('fetch', blockedFetch); });
  afterEach(() => { expect(blockedFetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it('renders exact FG source counts, distance accuracy and observed denominators without XP conflation', () => {
    const research = getNFLKickingResearch({ season: 2026, logs: [log('current', 2026, {
      fieldGoalsMade: 2, fieldGoalsAttempted: 4, extraPointsMade: 17, extraPointsAttempted: 19, kickingPoints: 23,
      fieldGoalsMadeUnder40: 1, fieldGoalsAttemptedUnder40: 1,
      fieldGoalsMade40To49: 1, fieldGoalsAttempted40To49: 2,
      fieldGoalsMade50Plus: 0, fieldGoalsAttempted50Plus: 1,
    }), log('prior', 2025, { fieldGoalsMade: 1, fieldGoalsAttempted: 2 })] });
    const html = renderToStaticMarkup(<NFLKickingResearch research={research} />);
    for (const value of ['Recent L3', 'Recent L5', 'Season 2026', '2 made (1 observed games) / 4 attempted (1 observed games)',
      '3 made (2 observed games) / 6 attempted (2 observed games)', '50% (2/4 paired made/attempted; 1 observed games)',
      'Under 40 yards', '40-49 yards', '50+ yards', '100% (1/1', '50% (1/2', '0% (0/1',
      'Field goal attempts/game', '4 (1 observed games)', 'Kicking points (not field goals made)', '23 (1 observed games)']) expect(html).toContain(value);
    for (const invented of ['17 made', '19 attempted', '100% (17/19', 'text-emerald', 'text-green', 'Favorable']) expect(html).not.toContain(invented);
  });

  it('reports supplied seasons and partial history without claiming a complete career', () => {
    const history = [log('old', 2024, { fgm: 1, fga: 2 }), log('new', 2026, { fgm: 2, fga: 3 })];
    const html = renderToStaticMarkup(<NFLKickingResearch research={getNFLKickingResearch({ season: 2026, logs: [], careerLogs: history })} />);
    expect(html).toContain('Supplied history only (not verified full career)');
    expect(html).toContain('2 supplied games; 2 observed seasons: 2024, 2026');
    expect(html).toContain('3 made (2 observed games) / 5 attempted (2 observed games)');
    expect(html).not.toContain('Career accuracy');
  });

  it('keeps zero attempts distinct from missing stats and lists opportunity, wind, roof and source gaps', () => {
    const research = getNFLKickingResearch({ season: 2026, logs: [log('zero', 2026, { fgm: 0, fga: 0 })], opportunity: {
      teamTotal: { value: 24.5, source: 'Fixture book', retrievedAt: '2026-10-17T12:00:00Z', sampleId: 'game-1' },
    } });
    const html = renderToStaticMarkup(<NFLKickingResearch research={research} />);
    for (const value of ['0 made (1 observed games) / 0 attempted (1 observed games)', 'Field goal accuracy</dt><dd class="mt-1 text-xs text-slate-300 [overflow-wrap:anywhere]">Unavailable',
      'Career coverage: Unavailable', 'opportunity / fourth Down Opportunities', 'weather / wind', 'weather / roof Open Closed', 'Unavailable evidence',
      '24.5; source: Fixture book; retrieved: 2026-10-17T12:00:00Z; sample: game-1', 'Supplied NFLGameLogEntry.stats', 'Sources']) expect(html).toContain(value);
    expect(html).not.toContain('0% (0/0');
    expect(html).not.toContain('text-emerald');
  });

  it('preserves weather and stale injury facts without assuming health or a closed roof', () => {
    const research = getNFLKickingResearch({ season: 2026, logs: [], weatherContext: {
      venue: { id: 'venue', name: 'Fixture venue', indoor: true, city: null, state: null, country: null }, environment: 'INDOOR',
      kickoff: '2026-10-18T12:00:00Z', wind: { speed: 24, unit: 'mph' }, gusts: { speed: 35, unit: 'mph' },
      temperature: { value: 38, unit: 'F' }, precipitation: { amount: 0.3, unit: 'in' }, conditions: 'Rain', severeConditions: ['Heavy rain'],
      forecastTimestamp: '2026-10-17T12:00:00Z', sourceStatus: 'UNKNOWN', sources: { venue: 'ESPN', forecast: 'Open-Meteo', geocode: null }, missingFields: ['roof open/closed status'],
    }, injuryContext: {
      player: { playerId: 1, player: 'Fixture Kicker', teamId: 1, team: 'Team', injury: 'Leg', status: 'Questionable', availabilityDesignation: 'QUESTIONABLE',
        position: 'K', evidence: 'Limited practice', updatedAt: '2026-10-10T12:00:00Z', sourceStatus: 'STALE', affectedRole: 'PLAYER', missingFields: ['current practice report'] },
      team: 'Team', teammateAbsences: [], opponentAbsences: [], sourceStatus: { provider: 'ESPN', status: 'STALE' }, lastUpdated: '2026-10-10T12:00:00Z', missingFields: ['current injury report'],
    } });
    const html = renderToStaticMarkup(<NFLKickingResearch research={research} />);
    for (const value of ['24 mph', '35 mph', '38 F', '0.3 in', 'Heavy rain', 'Fixture venue', 'indoor: true',
      'Unavailable - indoor designation does not establish roof state', 'Fixture Kicker: Questionable', 'Leg', 'Limited practice', 'ESPN: STALE',
      'current practice report', 'current injury report', 'Open-Meteo', '2026-10-17T12:00:00Z']) expect(html).toContain(value);
    for (const invented of ['Healthy', 'Confirmed available', 'Roof closed', 'text-green', 'text-emerald']) expect(html).not.toContain(invented);
  });
});