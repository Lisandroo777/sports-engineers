import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MLBContextFacts, MLBGameCoverage, MLBMarketResearch, type MLBGameMarketResearch } from './MLBMarketResearch';
import type { MLBContextEvidence, MLBResearchContext } from '../lib/mlb/researchContext';

const research: MLBGameMarketResearch = {
  events: [],
  quotes: [{ eventId: 'fixture', homeTeam: 'Home Club', awayTeam: 'Away Club', marketKey: 'totals_1st_1_innings', kind: 'nrfi_yrfi', period: 'first_inning', isAlternate: false,
    team: null, outcome: 'Under', selection: 'NRFI', line: 0.5, sportsbookKey: 'fixture_book', sportsbookName: 'Fixture Book', americanOdds: -125,
    lastUpdate: '2026-10-16T12:00:00Z', impliedProbability: 125 / 225, settlement: 'no_push', modelProbability: null, edge: null, recommendation: false, reason: 'MLB game-market model unavailable.' }],
};

function unavailable<Value>(): MLBContextEvidence<Value> {
  return { status: 'UNAVAILABLE', value: null, source: null, retrievedAt: '2026-10-16', sourceTimestamp: null, dataQualityNote: 'Not acquired.' };
}

function available<Value>(value: Value): MLBContextEvidence<Value> {
  return { status: 'AVAILABLE', value, source: 'MLB fixture feed', retrievedAt: '2026-10-16', sourceTimestamp: null, dataQualityNote: 'Explicit fixture data.' };
}

function context(): MLBResearchContext {
  return { gameId: 'fixture', retrievedAt: '2026-10-16', sourceTimestamp: null, sources: ['MLB fixture feed'], dataQualityNote: 'No inferred evidence.', gameStatus: unavailable(),
    probablePitchers: { home: available({ id: 1, fullName: 'Listed Pitcher' }), away: unavailable() },
    confirmedLineups: { home: unavailable(), away: available([{ id: 2, fullName: 'Listed Batter', battingOrder: 1 }]) },
    weather: available({ kind: 'OBSERVED', condition: 'Clear', temperatureF: '68', wind: '5 mph' }),
    venue: available({ id: 1, name: 'Fixture Park', roofType: 'Retractable', latitude: null, longitude: null }),
    playerInjuries: unavailable(), bullpenWorkload: unavailable() };
}

describe('MLB frontend research contract', () => {
  it('preserves quote identity and price without promoting it to a ranked pick', () => {
    const html = renderToStaticMarkup(<MLBMarketResearch research={research} />);
    for (const value of ['NRFI', 'Under', '0.5', 'Fixture Book', 'fixture_book', '-125', '55.555556%', 'totals_1st_1_innings', 'Not a recommendation', 'Model probability', 'Unavailable']) expect(html).toContain(value);
    for (const invented of ['ELITE', 'LEAN', 'data-tier', 'Recommendations', 'Compare', 'Research Complete']) expect(html).not.toContain(invented);
  });
  it('shows positive odds and a moneyline without inventing a numeric line', () => {
    const html = renderToStaticMarkup(<MLBMarketResearch research={{ events: [], quotes: [{ ...research.quotes[0], marketKey: 'h2h', kind: 'moneyline', line: null, americanOdds: 110, impliedProbability: 100 / 210 }] }} />);
    expect(html).toContain('+110');
    expect(html).toContain('Not applicable');
    expect(html).toContain('47.619048%');
  });
  it('keeps empty research and explicit per-game fetch gaps out of rejection language', () => {
    const html = renderToStaticMarkup(<MLBMarketResearch research={{ events: [], quotes: [] }} coverage={{ partialCoverage: true, games: [
      { gameId: 'one', awayTeam: 'Away', homeTeam: 'Home', status: 'NOT_FETCHED' },
      { gameId: 'two', status: 'BUDGET_BLOCKED', reason: 'Refresh approval required' },
      { gameId: 'three', status: 'NO_MARKETS' },
    ] }} />);
    for (const value of ['not fetched', 'budget blocked', 'no markets', 'Refresh approval required', 'not a researched rejection']) expect(html).toContain(value);
    expect(html).not.toContain('No recommendable plays');
    expect(renderToStaticMarkup(<MLBGameCoverage coverage={{ expectedGames: 3 }} />)).toContain('Per-game fetch status unavailable');
  });
  it('shows blocked and empty event statuses plus unmatched scope without claiming research completion', () => {
    const event = { id: 'fixture', homeTeam: 'Home', awayTeam: 'Away', commenceTime: '2026-10-16T20:00:00Z' };
    const html = renderToStaticMarkup(<MLBMarketResearch research={{ quotes: [], events: [
      { event, status: 'unavailable', requestedMarkets: ['h2h'], missingMarkets: ['h2h'], quotes: [], issues: [{ stage: 'odds', code: 'budget_blocked', message: 'Refresh approval required.' }] },
      { event: { ...event, id: 'empty' }, status: 'empty', requestedMarkets: [], missingMarkets: [], quotes: [], issues: [] },
    ] }} meta={{ partialCoverage: true, gamesEligible: 3, eventsMatched: 1, status: 'SPORTSBOOK_DATA_REQUIRED' }} />);
    for (const value of ['budget blocked', 'Refresh approval required.', 'No markets posted', 'Missing markets: h2h', 'Partial quote coverage', '2 eligible games', 'markets not fetched']) expect(html).toContain(value);
    expect(html).not.toContain('Research Complete');
    expect(html).not.toContain('No recommendable plays');
  });
  it('renders neutral explicit MLB facts and unavailable fields without treating availability as agreement', () => {
    const html = renderToStaticMarkup(<MLBContextFacts context={context()} />);
    for (const value of ['Listed Pitcher', 'probable, not confirmed', 'Listed Batter', 'Confirmed feed batting order', 'no confirmed batting order', 'Observed weather (not a forecast)', '68 F', 'Fixture Park', 'open/closed state unknown', 'Bullpen workload', 'Unavailable']) expect(html).toContain(value);
    for (const invented of ['text-emerald', 'agree', 'Healthy', 'Favorable']) expect(html).not.toContain(invented);
  });
  it('does not infer health or injuries from an active player status', () => {
    const facts = context();
    facts.playerInjuries = available([
      { playerId: 1, name: 'Status Player', code: 'A', description: 'Active', explicitlyInjured: null },
      { playerId: 2, name: 'Injured Player', code: 'IL10', description: 'Injured list', explicitlyInjured: true },
    ]);
    const html = renderToStaticMarkup(<MLBContextFacts context={facts} />);
    expect(html).toContain('Status Player: A / Active');
    expect(html).toContain('Injured Player: IL10 / Injured list / explicit injury flag');
    expect(html).not.toContain('healthy');
  });
});