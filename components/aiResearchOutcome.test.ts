import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { classifyResearchFailure, ResearchStorageUnavailablePanel } from './aiResearchOutcome';

describe('AI research failure classification', () => {
  it.each([
    ['NO_GAMES', 'DATA_UNAVAILABLE'],
    ['NO_GAMES_SCHEDULED', 'DATA_UNAVAILABLE'],
    ['SLATE_COMPLETE', 'SLATE_COMPLETE'],
    ['EVENT_LIST_REQUIRED', 'DATA_UNAVAILABLE'],
    ['NO_CACHED_SPORTSBOOK_DATA', 'DATA_UNAVAILABLE'],
    ['NO_SPORTSBOOK_DATA', 'DATA_UNAVAILABLE'],
    ['MARKETS_NOT_POSTED', 'DATA_UNAVAILABLE'],
    ['PROVIDER_ERROR', 'CONNECTION_ERROR'],
    ['RESEARCH_STORAGE_UNAVAILABLE', 'STORAGE_UNAVAILABLE'],
    ['NOT_FOUND', 'CLARIFY'],
    ['INVALID_DATE', 'CLARIFY'],
    ['NO_ELITE_RESULTS', 'NO_ELITE_RESULTS'],
    ['NO_CANDIDATES', 'NO_ELITE_RESULTS'],
  ])('preserves the specific %s outcome even when research is incomplete', (status, expected) => {
    expect(classifyResearchFailure(status, false)).toBe(expected);
  });

  it.each(['RESERVE_BLOCKED', 'PAID_REFRESH_NOT_AUTHORIZED', 'SPORTSBOOK_DATA_REQUIRED', 'BUDGET_LIMITED'])(
    'retains the spending safety block for %s', status => {
      expect(classifyResearchFailure(status, false)).toBe('TEMP_UNAVAILABLE');
    });

  it('preserves genuinely incomplete research and successful ranking behavior', () => {
    expect(classifyResearchFailure('RESEARCH_INCOMPLETE', false)).toBe('RESEARCH_INCOMPLETE');
    expect(classifyResearchFailure('SUCCESS', false)).toBe('RESEARCH_INCOMPLETE');
    expect(classifyResearchFailure('SUCCESS', true)).toBeNull();
    expect(classifyResearchFailure('', undefined)).toBeNull();
  });

  it.each([true, false, undefined])('classifies storage failures independently of research completeness %s', researchComplete => {
    expect(classifyResearchFailure('RESEARCH_STORAGE_UNAVAILABLE', researchComplete)).toBe('STORAGE_UNAVAILABLE');
  });

  it('leaves unknown HTTP failure codes to the generic error fallback', () => {
    expect(classifyResearchFailure('AI_UNAVAILABLE')).toBeNull();
    expect(classifyResearchFailure('UNKNOWN_ERROR')).toBeNull();
  });

  it.each([
    'Research was evaluated, but saved research storage is temporarily unavailable. No new request was started automatically.',
    'Saved research is temporarily unavailable.',
    null,
  ])('renders the storage panel with safe server detail %s', error => {
    const markup = renderToStaticMarkup(createElement(ResearchStorageUnavailablePanel, { error, onRetry: () => {} }));
    expect(markup).toContain('role="status"');
    expect(markup).toContain('Research Storage Temporarily Unavailable');
    expect(markup).toContain('Sportsbook research could not be saved or restored. Previous quotes shown below are historical, not current recommendations.');
    expect(markup).toContain('Try Again');
    if (error) expect(markup).toContain(error);
    expect(markup).not.toMatch(/Data Connection Issue|No recommendable plays|Research Complete|Data Unavailable|Sportsbook Data Temporarily Unavailable|couldn.*load|not fetched|\[dev\]/);
  });
});