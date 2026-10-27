import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NBAPresentationCards, type NBAClientPresentation } from './NBAPresentationCards';
import type { PresentedPick, PresentationTier } from '../lib/nba/presentation';

function pick(tier: PresentationTier): PresentedPick {
  return { candidateId: tier, subject: { kind: 'PLAYER_PROP', gameId: 'fixture', player: { id: null, name: `${tier} Player`, team: 'Fixture Team' },
    market: { key: 'points', label: 'Points', side: 'over', line: 20.5 } },
    tierDecision: { pickTier: tier, tierScore: 75, tierReason: `${tier} source decision`, tierRequirementsPassed: [], tierRequirementsFailed: [] },
    disposition: tier === 'PASS' ? 'PASS' : tier === 'LEAN' ? 'LEAN' : 'RECOMMENDED',
    pricing: { state: 'PRICED', sportsbook: 'Fixture Book', americanOdds: -110, quoteStatus: 'CURRENT' },
    metrics: { trueProbability: 63.2, modelProbability: 63.2, evPercent: 4.5, researchScore: 75, tierScore: 75 },
    season: { phase: 'REGULAR', certainty: 'VERIFIED', reason: null },
    researchEvidence: [{ id: 'availability', category: 'AVAILABILITY', detail: 'Fixture official report.', source: 'Fixture source', observedAt: '2026-10-11T12:00:00Z', stance: 'CONTEXT' }], missing: [] };
}

function presentation(picks: PresentedPick[]): NBAClientPresentation {
  return { schemaVersion: 'deepside-nba-pick-presentation/1', outcome: 'PICKS_AVAILABLE', requestedSort: 'BEST',
    sortStatus: 'UPSTREAM_ORDER', picks, recommendedCandidateIds: picks.map(entry => entry.candidateId) };
}

describe('NBA frontend presentation contract', () => {
  it.each([
    ['h2h_q1', '1Q Moneyline', 'MONEYLINE', null], ['spreads_q1', '1Q Spread', 'SPREAD', -2.5],
    ['totals_q1', '1Q Total', 'TOTAL', 55.5], ['alternate_spreads', 'Alternate Spread', 'SPREAD', 7.5],
    ['alternate_totals', 'Alternate Total', 'TOTAL', 240.5], ['alternate_team_totals', 'Alternate Team Total', 'TEAM_TOTAL', 115.5],
  ] as const)('preserves exact %s identity on the visible game contract', (key, label, type, line) => {
    const record = pick('LEAN'); record.tierDecision = null; record.disposition = 'RESEARCH_ONLY';
    record.subject = { kind: 'GAME_LINE', gameId: 'fixture', home: { id: 1, name: 'Home' }, away: { id: 2, name: 'Away' },
      market: { key, label, type, line, selection: type === 'MONEYLINE' || type === 'SPREAD' ? 'HOME' : 'UNDER', team: 'HOME' } };
    const html = renderToStaticMarkup(<NBAPresentationCards presentation={presentation([record])} />);
    expect(html).toContain(label);
    expect(html).toContain(`data-market-key="${key}"`);
    expect(html).toContain('Fixture Book');
    if (line != null) expect(html).toContain(String(line));
    expect(html).not.toContain('63.2%');
  });
  it('mounts only 20 research cards from thousands while keeping pagination counts', () => {
    const records = Array.from({ length: 5989 }, (_, index) => ({ ...pick('LEAN'), candidateId: `research-${index}`,
      tierDecision: null, disposition: 'RESEARCH_ONLY' as const }));
    const html = renderToStaticMarkup(<NBAPresentationCards presentation={presentation(records)} />);
    expect((html.match(/<article /g) ?? []).length).toBe(20);
    expect(html).toContain('5,989 outcomes');
    expect(html).toContain('Research page');
    expect(html).not.toContain('data-candidate-id="research-20"');
  });
  it('keeps preseason research-only even when an invalid upstream selected tier is supplied', () => {
    const record = pick('EDGE');
    record.season.phase = 'PRESEASON';
    const html = renderToStaticMarkup(<NBAPresentationCards presentation={presentation([record])} />);
    expect(html).toContain('data-tier="EDGE"');
    expect(html).toContain('RESEARCH ONLY');
    expect(html).not.toContain('>Recommendations</h2>');
    expect(html).not.toContain('63.2%');
  });
  it.each(['NUKE', 'ELITE', 'SHARP', 'EDGE', 'LEAN', 'PASS'] as const)('preserves the authoritative %s label and source values', tier => {
    const record = pick(tier);
    const html = renderToStaticMarkup(<NBAPresentationCards presentation={presentation([record])} />);
    expect(html).toContain(`data-tier="${tier}"`);
    expect(html).toContain('63.2%');
    expect(html).toContain('4.5%');
    expect(html).toContain('75/100');
    expect(html).toContain('Fixture Book');
    expect(html).toContain('Fixture official report.');
    expect(record.metrics.trueProbability).toBe(63.2);
  });
  it('never puts PASS in recommendations even if an incorrect selected ID is supplied', () => {
    const html = renderToStaticMarkup(<NBAPresentationCards presentation={presentation([pick('PASS')])} />);
    expect(html).not.toContain('>Recommendations</h2>');
    expect(html).toContain('PASS · NOT A WAGER');
    expect(html).toContain('Not recommended wagers');
  });
  it.each(['STALE', 'UNAVAILABLE'] as const)('does not display %s prices or unsupported numeric confidence', status => {
    const record = pick('EDGE');
    record.pricing.quoteStatus = status;
    const html = renderToStaticMarkup(<NBAPresentationCards presentation={presentation([record])} />);
    expect(html).not.toContain('Fixture Book');
    expect(html).not.toContain('63.2%');
    expect(html).not.toContain('4.5%');
    expect(html).toContain('RESEARCH ONLY');
    expect(html).not.toContain('>Recommendations</h2>');
  });
  it('shows research-only and unpriced states without manufacturing a tier or numbers', () => {
    const record = pick('LEAN');
    record.tierDecision = null;
    record.disposition = 'RESEARCH_ONLY';
    record.pricing = { state: 'UNPRICED', sportsbook: null, americanOdds: null, quoteStatus: 'UNAVAILABLE' };
    const html = renderToStaticMarkup(<NBAPresentationCards presentation={presentation([record])} />);
    expect(html).toContain('UNPRICED · RESEARCH ONLY');
    expect(html).toContain('data-tier="RESEARCH_ONLY"');
    expect(html).not.toContain('63.2%');
    expect(html).not.toContain('75/100');
  });
  it('keeps upstream candidate order and shows an honest empty state', () => {
    const html = renderToStaticMarkup(<NBAPresentationCards presentation={presentation([pick('EDGE'), pick('ELITE')])} />);
    expect(html.indexOf('EDGE Player')).toBeLessThan(html.indexOf('ELITE Player'));
    expect(renderToStaticMarkup(<NBAPresentationCards presentation={presentation([])} />)).toContain('No qualified NBA picks');
  });
});